import Foundation

public enum CPUArchitecture: String, Sendable {
    case arm64
    case x86_64

    /// The architecture this code was compiled for (the slice of a universal app that is running).
    public static var current: CPUArchitecture {
        #if arch(arm64)
        return .arm64
        #else
        return .x86_64
        #endif
    }
}

/// Reads which CPU architectures a Mach-O executable (thin or universal) contains, so the app can
/// say "this download is for Apple Silicon" instead of failing with "Bad CPU type in executable".
public enum MachO {
    private static let cpuTypeX86_64: UInt32 = 0x0100_0007
    private static let cpuTypeARM64: UInt32 = 0x0100_000C

    public static func architectures(ofFile url: URL) -> Set<CPUArchitecture> {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return [] }
        defer { try? handle.close() }
        let header = (try? handle.read(upToCount: 4096)) ?? Data()
        return architectures(ofHeader: header)
    }

    public static func architectures(ofHeader data: Data) -> Set<CPUArchitecture> {
        guard let magicBE = uint32(data, at: 0, bigEndian: true) else { return [] }
        switch magicBE {
        case 0xCAFE_BABE, 0xCAFE_BABF:
            // Universal binary: big-endian fat header, 20-byte (or 32-byte, 64-bit) entries.
            let entrySize = magicBE == 0xCAFE_BABF ? 32 : 20
            guard let count = uint32(data, at: 4, bigEndian: true), count < 32 else { return [] }
            var found = Set<CPUArchitecture>()
            for index in 0..<Int(count) {
                if let cpu = uint32(data, at: 8 + index * entrySize, bigEndian: true), let arch = architecture(cpu) {
                    found.insert(arch)
                }
            }
            return found
        case 0xCFFA_EDFE, 0xCEFA_EDFE:
            // Thin little-endian Mach-O (MH_MAGIC_64 / MH_MAGIC stored little-endian).
            guard let cpu = uint32(data, at: 4, bigEndian: false), let arch = architecture(cpu) else { return [] }
            return [arch]
        default:
            return []
        }
    }

    /// Whether a binary with `architectures` can run here; Apple silicon also runs Intel code through Rosetta.
    public static func canRun(_ architectures: Set<CPUArchitecture>, on host: CPUArchitecture = .current) -> Bool {
        if architectures.isEmpty { return true } // not a Mach-O we understand: let the launch decide
        if architectures.contains(host) { return true }
        return host == .arm64 && architectures.contains(.x86_64)
    }

    private static func architecture(_ cpuType: UInt32) -> CPUArchitecture? {
        switch cpuType {
        case cpuTypeARM64: return .arm64
        case cpuTypeX86_64: return .x86_64
        default: return nil
        }
    }

    private static func uint32(_ data: Data, at offset: Int, bigEndian: Bool) -> UInt32? {
        guard offset >= 0, data.count >= offset + 4 else { return nil }
        let start = data.startIndex + offset
        let bytes = [UInt8](data[start..<start + 4])
        if bigEndian {
            return UInt32(bytes[0]) << 24 | UInt32(bytes[1]) << 16 | UInt32(bytes[2]) << 8 | UInt32(bytes[3])
        }
        return UInt32(bytes[3]) << 24 | UInt32(bytes[2]) << 16 | UInt32(bytes[1]) << 8 | UInt32(bytes[0])
    }
}
