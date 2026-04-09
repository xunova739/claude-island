//
//  NotchUserDriver.swift
//  ClaudeIsland
//
//  GitHub Releases-based update manager (replaces Sparkle)
//  Downloads latest build from xunova739/claude-island releases
//

import AppKit
import Combine
import Foundation

// MARK: - UpdateState

enum UpdateState: Equatable {
    case idle
    case checking
    case upToDate
    case found(version: String, releaseNotes: String?)
    case downloading(progress: Double)
    case extracting(progress: Double)
    case readyToInstall(version: String)
    case installing
    case error(message: String)

    var isActive: Bool {
        switch self {
        case .idle, .upToDate, .error: return false
        default: return true
        }
    }
}

// MARK: - UpdateManager

@MainActor
class UpdateManager: NSObject, ObservableObject {
    static let shared = UpdateManager()

    @Published var state: UpdateState = .idle
    @Published var hasUnseenUpdate: Bool = false

    private let owner = "xunova739"
    private let repo = "claude-island"
    private let releaseTag = "latest-build"
    private let dmgName = "ClaudeIsland-focused-notch.dmg"

    private var downloadTask: URLSessionDownloadTask?
    private var downloadedDMGURL: URL?
    private var latestVersion: String = ""

    override init() { super.init() }

    // MARK: - Public API

    func checkForUpdates() {
        state = .checking
        Task {
            await fetchLatestRelease()
        }
    }

    func downloadAndInstall() {
        guard let url = downloadURL() else {
            state = .error(message: "No download URL found")
            return
        }
        Task {
            await downloadDMG(from: url)
        }
    }

    func installAndRelaunch() {
        guard let dmgURL = downloadedDMGURL else {
            state = .error(message: "No downloaded file")
            return
        }
        Task {
            await mountAndInstall(dmgURL: dmgURL)
        }
    }

    func markUpdateSeen() {
        hasUnseenUpdate = false
    }

    func cancelDownload() {
        downloadTask?.cancel()
        state = .idle
    }

    // MARK: - GitHub API

    private var _downloadURL: URL?

    private func downloadURL() -> URL? { _downloadURL }

    private func fetchLatestRelease() async {
        let apiURL = URL(string: "https://api.github.com/repos/\(owner)/\(repo)/releases/tags/\(releaseTag)")!
        var request = URLRequest(url: apiURL)
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                state = .upToDate
                return
            }
            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let assets = json["assets"] as? [[String: Any]],
                  let dmgAsset = assets.first(where: {
                      ($0["name"] as? String)?.hasSuffix(".dmg") == true
                  }),
                  let downloadURLStr = dmgAsset["browser_download_url"] as? String,
                  let downloadURL = URL(string: downloadURLStr) else {
                state = .upToDate
                return
            }

            let versionName = (json["name"] as? String) ?? releaseTag
            let body = (json["body"] as? String) ?? ""
            _downloadURL = downloadURL
            latestVersion = versionName
            state = .found(version: versionName, releaseNotes: body)
            hasUnseenUpdate = true
        } catch {
            state = .error(message: "Network error: \(error.localizedDescription)")
        }
    }

    // MARK: - Download

    private func downloadDMG(from url: URL) async {
        state = .downloading(progress: 0)

        let tempDir = FileManager.default.temporaryDirectory
        let destURL = tempDir.appendingPathComponent(dmgName)

        do {
            // Stream download with progress
            let (asyncBytes, response) = try await URLSession.shared.bytes(from: url)
            let totalBytes = (response as? HTTPURLResponse)?
                .value(forHTTPHeaderField: "Content-Length")
                .flatMap { Int64($0) } ?? 0

            var receivedBytes: Int64 = 0
            var data = Data()

            for try await byte in asyncBytes {
                data.append(byte)
                receivedBytes += 1
                if totalBytes > 0 && receivedBytes % 65536 == 0 {
                    let progress = Double(receivedBytes) / Double(totalBytes)
                    state = .downloading(progress: min(progress, 1.0))
                }
            }

            state = .extracting(progress: 0.5)
            try data.write(to: destURL)
            state = .extracting(progress: 1.0)

            downloadedDMGURL = destURL
            state = .readyToInstall(version: latestVersion)
        } catch {
            state = .error(message: "Download failed: \(error.localizedDescription)")
        }
    }

    // MARK: - Mount & Install

    private func mountAndInstall(dmgURL: URL) async {
        state = .installing

        // Mount DMG
        let mountResult = await runShell("/usr/bin/hdiutil", args: [
            "attach", dmgURL.path, "-nobrowse", "-quiet"
        ])

        guard mountResult.exitCode == 0 else {
            state = .error(message: "Failed to mount DMG")
            return
        }

        // Find mounted volume
        guard let volumePath = findMountedVolume() else {
            state = .error(message: "Could not find mounted volume")
            return
        }

        let appSource = (volumePath as NSString).appendingPathComponent("Claude Island.app")

        // Use AppleScript to copy with admin privileges (shows macOS password dialog)
        let installScript = """
        do shell script "cp -Rf '\(appSource)' '/Applications/'" with administrator privileges
        """

        let scriptResult = await runAppleScript(installScript)

        // Unmount DMG
        _ = await runShell("/usr/bin/hdiutil", args: ["detach", volumePath, "-quiet"])

        if scriptResult {
            // Relaunch
            let appPath = "/Applications/Claude Island.app"
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                let url = URL(fileURLWithPath: appPath)
                let config = NSWorkspace.OpenConfiguration()
                NSWorkspace.shared.openApplication(at: url, configuration: config) { _, _ in }
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                    NSApplication.shared.terminate(nil)
                }
            }
        } else {
            state = .error(message: "Install failed — try running manually")
        }
    }

    private func findMountedVolume() -> String? {
        let volumesURL = URL(fileURLWithPath: "/Volumes")
        guard let contents = try? FileManager.default.contentsOfDirectory(
            at: volumesURL, includingPropertiesForKeys: nil
        ) else { return nil }

        for vol in contents {
            let appPath = vol.appendingPathComponent("Claude Island.app").path
            if FileManager.default.fileExists(atPath: appPath) {
                return vol.path
            }
        }
        return nil
    }

    // MARK: - Shell Helpers

    private struct ShellResult {
        let exitCode: Int32
        let output: String
    }

    private func runShell(_ executable: String, args: [String]) async -> ShellResult {
        await withCheckedContinuation { continuation in
            DispatchQueue.global().async {
                let process = Process()
                process.executableURL = URL(fileURLWithPath: executable)
                process.arguments = args
                let pipe = Pipe()
                process.standardOutput = pipe
                process.standardError = pipe
                do {
                    try process.run()
                    process.waitUntilExit()
                    let data = pipe.fileHandleForReading.readDataToEndOfFile()
                    let output = String(data: data, encoding: .utf8) ?? ""
                    continuation.resume(returning: ShellResult(exitCode: process.terminationStatus, output: output))
                } catch {
                    continuation.resume(returning: ShellResult(exitCode: -1, output: error.localizedDescription))
                }
            }
        }
    }

    private func runAppleScript(_ source: String) async -> Bool {
        await withCheckedContinuation { continuation in
            DispatchQueue.main.async {
                var error: NSDictionary?
                let script = NSAppleScript(source: source)
                script?.executeAndReturnError(&error)
                continuation.resume(returning: error == nil)
            }
        }
    }
}
