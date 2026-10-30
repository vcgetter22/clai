import Foundation
#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#endif

/// Size and modification time: enough to tell whether a log changed since the last read.
public struct FileStamp: Equatable, Sendable {
    public var size: UInt64
    public var modified: Double
    /// Tells a file replaced under the same name from one that grew.
    public var inode: UInt64

    public init(size: UInt64, modified: Double, inode: UInt64 = 0) {
        self.size = size
        self.modified = modified
        self.inode = inode
    }

    public static func of(_ path: String) -> FileStamp? {
        var info = stat()
        guard stat(path, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG else { return nil }
        #if canImport(Darwin)
        let modified = Double(info.st_mtimespec.tv_sec) + Double(info.st_mtimespec.tv_nsec) / 1e9
        #else
        let modified = Double(info.st_mtim.tv_sec) + Double(info.st_mtim.tv_nsec) / 1e9
        #endif
        return FileStamp(size: UInt64(info.st_size), modified: modified, inode: UInt64(info.st_ino))
    }
}

/// Finds log files. clai only looks where the tools keep their logs and never inside the folders
/// macOS guards with a permission prompt (Desktop, Documents, Downloads, iCloud Drive, other apps'
/// containers, removable volumes), not even when a tool's folder is a link into one of them.
public enum FileFinder {
    /// Regular files under `root` (recursively, never following links) whose name passes `include`.
    /// Missing, unreadable or guarded folders give no files.
    public static func files(under root: String, maxDepth: Int = 12, include: (String) -> Bool) -> [String] {
        guard isSafe(root) else { return [] }
        var out: [String] = []
        walk(root, depth: 0, maxDepth: maxDepth, include: include, into: &out)
        return out
    }

    private static func walk(_ dir: String, depth: Int, maxDepth: Int, include: (String) -> Bool, into out: inout [String]) {
        guard depth <= maxDepth, let names = try? FileManager.default.contentsOfDirectory(atPath: dir) else { return }
        for name in names where !name.hasPrefix(".") || name == ".claude" {
            let path = dir + "/" + name
            var info = stat()
            guard lstat(path, &info) == 0 else { continue }
            switch info.st_mode & S_IFMT {
            case S_IFDIR:
                walk(path, depth: depth + 1, maxDepth: maxDepth, include: include, into: &out)
            case S_IFREG:
                if include(name) { out.append(path) }
            default:
                continue // links, sockets, devices
            }
        }
    }

    /// The real user's home folder, whatever `HOME` says.
    public static var userHome: String {
        if let pw = getpwuid(getuid()), let dir = pw.pointee.pw_dir { return String(cString: dir) }
        return NSHomeDirectory()
    }

    /// Folders where reading makes macOS ask the user for access.
    public static func guardedFolders(home: String) -> [String] {
        let inHome = ["/Desktop", "/Documents", "/Downloads", "/Pictures", "/Movies", "/Music", "/Public",
                      "/Library/Mobile Documents", "/Library/CloudStorage", "/Library/Containers", "/Library/Group Containers"]
            .map { home + $0 }
        // Removable and network volumes, unless the home folder itself lives on one.
        let volumes = ["/Volumes", "/Network"].filter { !home.hasPrefix($0 + "/") }
        return inHome + volumes
    }

    public static func isGuarded(_ path: String, home: String = FileFinder.userHome) -> Bool {
        let path = (path as NSString).standardizingPath
        return guardedFolders(home: home).contains { path == $0 || path.hasPrefix($0 + "/") }
    }

    /// Whether `root` exists and it and the folders on the way to it stay out of guarded folders.
    /// Links are read as text (`readlink`) and their targets checked the same way, so a guarded
    /// folder is never touched, not even through a chain of links.
    public static func isSafe(_ root: String, home: String = FileFinder.userHome) -> Bool {
        isSafe(root, home: home, hops: 0)
    }

    private static func isSafe(_ root: String, home: String, hops: Int) -> Bool {
        guard hops < 8, !isGuarded(root, home: home) else { return false }
        var path = ""
        for component in (root as NSString).pathComponents where component != "/" {
            path += "/" + component
            var info = stat()
            guard lstat(path, &info) == 0 else { return false }
            if info.st_mode & S_IFMT == S_IFLNK {
                guard let target = try? FileManager.default.destinationOfSymbolicLink(atPath: path) else { return false }
                let absolute = target.hasPrefix("/") ? target : ((path as NSString).deletingLastPathComponent as NSString).appendingPathComponent(target)
                guard isSafe((absolute as NSString).standardizingPath, home: home, hops: hops + 1) else { return false }
            }
        }
        return true
    }

    /// The immediate subfolders of `dir`.
    public static func subdirectories(of dir: String) -> [String] {
        guard isSafe(dir), let names = try? FileManager.default.contentsOfDirectory(atPath: dir) else { return [] }
        return names.compactMap { name in
            let path = dir + "/" + name
            var info = stat()
            return lstat(path, &info) == 0 && info.st_mode & S_IFMT == S_IFDIR ? path : nil
        }
    }

    public static func isDirectory(_ path: String) -> Bool {
        var info = stat()
        return stat(path, &info) == 0 && info.st_mode & S_IFMT == S_IFDIR
    }
}

/// Reads JSON Lines files incrementally.
public enum LineReader {
    /// Hands every complete line of the file at `path`, from byte `offset` on, to `body` and
    /// returns the offset just past the last line read. A last line without a newline is read
    /// only if it is complete JSON; a line the tool is still writing waits for the next read.
    /// Lines are never copied unless `body` copies them.
    public static func read(_ path: String, from offset: UInt64, chunkSize: Int = 1 << 22, _ body: (UnsafeRawBufferPointer) -> Void) throws -> UInt64 {
        let fd = open(path, O_RDONLY)
        guard fd >= 0 else { throw ReadError.cannotOpen(path) }
        defer { close(fd) }

        var buffer = [UInt8](repeating: 0, count: max(chunkSize, 4096))
        var carry = 0 // bytes of an unfinished line at the start of the buffer
        var position = offset // file offset of buffer[0]
        var readOffset = offset

        while true {
            if carry == buffer.count {
                // One line longer than the buffer: grow it.
                buffer.append(contentsOf: [UInt8](repeating: 0, count: buffer.count))
            }
            let space = buffer.count - carry
            let got = buffer.withUnsafeMutableBytes { raw -> Int in
                pread(fd, raw.baseAddress! + carry, space, off_t(readOffset))
            }
            if got < 0 {
                if errno == EINTR { continue }
                throw ReadError.cannotRead(path)
            }
            if got == 0 { break }
            readOffset += UInt64(got)
            let filled = carry + got
            var lineStart = 0
            buffer.withUnsafeBytes { raw in
                let base = raw.baseAddress!
                var searchFrom = carry
                while searchFrom < filled,
                      let hit = memchr(base + searchFrom, 0x0A, filled - searchFrom) {
                    let end = base.distance(to: UnsafeRawPointer(hit))
                    var lineEnd = end
                    if lineEnd > lineStart, raw[lineEnd - 1] == 0x0D { lineEnd -= 1 }
                    if lineEnd > lineStart {
                        body(UnsafeRawBufferPointer(rebasing: raw[lineStart..<lineEnd]))
                    }
                    lineStart = end + 1
                    searchFrom = lineStart
                }
            }
            position += UInt64(lineStart)
            carry = filled - lineStart
            if carry > 0, lineStart > 0 {
                buffer.withUnsafeMutableBytes { raw in
                    let base = raw.baseAddress!
                    memmove(base, base + lineStart, carry)
                }
            }
        }

        if carry > 0 {
            let tail = Data(buffer[0..<carry])
            if (try? JSONSerialization.jsonObject(with: tail)) != nil {
                tail.withUnsafeBytes { body($0) }
                position += UInt64(carry)
            }
        }
        return position
    }

    public enum ReadError: Error, Equatable {
        case cannotOpen(String)
        case cannotRead(String)
    }
}

/// Small helpers for reading JSON without decoding more than needed.
public enum JSON {
    /// Whether `needle` occurs in `haystack`: a cheap filter before parsing a line.
    public static func contains(_ haystack: UnsafeRawBufferPointer, _ needle: StaticString) -> Bool {
        needle.withUTF8Buffer { n in
            guard n.count > 0 else { return true }
            guard haystack.count >= n.count, let h = haystack.baseAddress, let nb = n.baseAddress else { return false }
            let first = Int32(nb[0])
            var start = h
            let last = h + (haystack.count - n.count)
            while start <= last {
                guard let found = memchr(start, first, last - start + 1) else { return false }
                if memcmp(found, nb, n.count) == 0 { return true }
                start = UnsafeRawPointer(found) + 1
            }
            return false
        }
    }

    /// One JSON object from a line, with only its metadata parsed (see `metadata`), or nil.
    public static func object(_ bytes: UnsafeRawBufferPointer) -> [String: Any]? {
        guard let data = metadata(bytes) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    /// The JSON object in a file, with only its metadata parsed, or nil.
    public static func object(atPath path: String) -> [String: Any]? {
        guard let data = FileManager.default.contents(atPath: path) else { return nil }
        return data.withUnsafeBytes { object($0) }
    }

    /// The keys whose string values the readers use: kinds, ids, models, times and tiers.
    static let keptKeys: [StaticString] = [
        "type", "role", "id", "uuid", "model", "modelID", "timestamp", "_audit_timestamp",
        "sessionId", "session_id", "requestId", "request_id", "speed", "service_tier", "limit_id", "plan_type",
    ]

    /// A copy of a JSON text in which every string value is emptied unless its key is in `keptKeys`.
    /// Prompts, replies, thinking, tool input and file contents are stepped over (to their closing
    /// quote) and never decoded, so the readers parse metadata and token counts and nothing else.
    /// Keys, numbers and structure stay as they are. Nil when the text is not well formed.
    static func metadata(_ text: UnsafeRawBufferPointer) -> Data? {
        guard let start = text.baseAddress, text.count >= 2 else { return nil }
        let n = text.count
        let bytes = start.assumingMemoryBound(to: UInt8.self)
        var out = Data(capacity: min(n, 16_384))
        var keepStack: [Bool] = []
        var keep = false // whether string values at this point are kept
        var i = 0
        while i < n {
            let c = bytes[i]
            if c == 0x22 { // a string: find the quote that ends it, past escaped ones
                var end = i + 1
                while true {
                    guard end < n, let found = memchr(start + end, 0x22, n - end) else { return nil }
                    end = UnsafeRawPointer(found) - start
                    var slashes = 0
                    while end - slashes - 1 > i, bytes[end - slashes - 1] == 0x5C { slashes += 1 }
                    if slashes % 2 == 0 { break }
                    end += 1
                }
                var next = end + 1
                while next < n, bytes[next] == 0x20 || bytes[next] == 0x09 || bytes[next] == 0x0A || bytes[next] == 0x0D { next += 1 }
                if next < n, bytes[next] == 0x3A { // a key
                    out.append(bytes + i, count: end - i + 1)
                    keep = isKept(bytes + i + 1, count: end - i - 1)
                } else if keep {
                    out.append(bytes + i, count: end - i + 1)
                } else {
                    out.append(contentsOf: [0x22, 0x22])
                }
                i = end + 1
                continue
            }
            switch c {
            case 0x7B: // { an object's own keys decide
                keepStack.append(keep)
                keep = false
            case 0x5B: // [ elements follow the array's key
                keepStack.append(keep)
            case 0x7D, 0x5D: // } ]
                keep = keepStack.popLast() ?? false
            default:
                break
            }
            out.append(c)
            i += 1
        }
        return out
    }

    private static func isKept(_ key: UnsafePointer<UInt8>, count: Int) -> Bool {
        keptKeys.contains { $0.utf8CodeUnitCount == count && memcmp($0.utf8Start, key, count) == 0 }
    }

    /// A token count from any JSON number (or numeric string). Negative counts and counts above
    /// `Tokens.ceiling` come from corrupt logs and read as 0, so a corrupt log cannot stop clai or
    /// inflate a total, and readers add counts up without overflowing.
    public static func int(_ value: Any?) -> Int64 {
        func whole(_ d: Double) -> Int64 { d.isFinite && d > 0 && d <= Double(Tokens.ceiling) ? Int64(d) : 0 }
        switch value {
        case let v as Int: return v > 0 && Int64(v) <= Tokens.ceiling ? Int64(v) : 0
        case let v as Int64: return v > 0 && v <= Tokens.ceiling ? v : 0
        case let v as Double: return whole(v)
        case let v as NSNumber: return whole(v.doubleValue)
        case let v as String: return whole(Double(v) ?? 0)
        default: return 0
        }
    }

    public static func double(_ value: Any?) -> Double? {
        switch value {
        case let v as Double: return v
        case let v as Int: return Double(v)
        case let v as Int64: return Double(v)
        case let v as NSNumber: return v.doubleValue
        case let v as String: return Double(v)
        default: return nil
        }
    }
}

extension Dictionary where Key == String, Value == Any {
    func string(_ key: String) -> String? {
        guard let s = self[key] as? String, !s.isEmpty else { return nil }
        return s
    }

    func int(_ key: String) -> Int64 { JSON.int(self[key]) }

    func object(_ key: String) -> [String: Any]? { self[key] as? [String: Any] }
}
