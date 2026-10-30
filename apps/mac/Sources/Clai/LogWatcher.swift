import ClaiCore
import CoreServices
import Foundation

/// Tells when the tools write to their logs, so clai reads them a few seconds later instead of
/// polling. Watches the tools' log folders that exist: FSEvents cannot watch a missing folder, and
/// watching a parent such as the Claude app's data folder would wake clai for every cache write.
/// The list is renewed after every read, so a tool used for the first time is picked up by the
/// next safety read (every 5 minutes).
final class LogWatcher {
    private var stream: FSEventStreamRef?
    private var paths: [String] = []
    private let onChange: () -> Void

    init(onChange: @escaping () -> Void) {
        self.onChange = onChange
    }

    deinit { stop() }

    /// Watches the folders that exist (`folders` lists only those) and are safe to read.
    func watch(_ folders: [String]) {
        let next = Set(folders.filter { FileFinder.isDirectory($0) && FileFinder.isSafe($0) }).sorted()
        guard next != paths else { return }
        stop()
        paths = next
        guard !next.isEmpty else { return }

        var context = FSEventStreamContext(version: 0, info: Unmanaged.passUnretained(self).toOpaque(), retain: nil, release: nil, copyDescription: nil)
        let callback: FSEventStreamCallback = { _, info, count, eventPaths, _, _ in
            guard let info else { return }
            let watcher = Unmanaged<LogWatcher>.fromOpaque(info).takeUnretainedValue()
            let paths = unsafeBitCast(eventPaths, to: NSArray.self) as? [String] ?? []
            watcher.handle(paths, count: count)
        }
        let flags = FSEventStreamCreateFlags(kFSEventStreamCreateFlagUseCFTypes | kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagIgnoreSelf)
        guard let stream = FSEventStreamCreate(kCFAllocatorDefault, callback, &context, next as CFArray,
                                               FSEventStreamEventId(kFSEventStreamEventIdSinceNow), 2.0, flags) else { return }
        FSEventStreamSetDispatchQueue(stream, DispatchQueue.main)
        FSEventStreamStart(stream)
        self.stream = stream
    }

    func stop() {
        guard let stream else { return }
        FSEventStreamStop(stream)
        FSEventStreamInvalidate(stream)
        FSEventStreamRelease(stream)
        self.stream = nil
    }

    private func handle(_ paths: [String], count: Int) {
        // Only log-shaped files matter; SQLite's -shm file changes on every read.
        let relevant = paths.isEmpty || paths.contains { path in
            !path.hasSuffix("-shm") && (path.hasSuffix(".jsonl") || path.hasSuffix(".json") || path.hasSuffix(".db") || path.hasSuffix(".db-wal"))
        }
        if relevant { onChange() }
    }
}
