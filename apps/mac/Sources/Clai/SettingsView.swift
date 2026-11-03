import AppKit
import ClaiCore
import SwiftUI

struct SettingsPage: View {
    @ObservedObject var state: AppState
    let inWindow: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 6) {
                IconButton(symbol: "chevron.left", help: "Back") { state.page = .overview }
                Text("Settings")
                    .font(.system(size: 15, weight: .semibold))
                Spacer()
            }

            SettingsSection(title: "Menu bar") {
                Segmented(options: MenuBarFigure.allCases.map { ($0, $0.label) }, selection: $state.figure)
            }

            SettingsSection(title: "Your plans", caption: "For plan value: this month's usage at API prices against what the plan costs.") {
                ForEach([Vendor.anthropic, .openai, .google], id: \.self) { vendor in
                    PlanPicker(state: state, vendor: vendor)
                }
            }

            SettingsSection(title: "Claude plan limits",
                            caption: "Pro and Max limits count everything: claude.ai, the Claude apps, cloud sessions and Claude Code. Claude Code hands them to its status line; clai adds itself there, runs your own status line as before, and shows the limits while you use Claude Code in Terminal.") {
                SwitchRow(title: "Show Claude plan limits", isOn: Binding(
                    get: { state.statusLineConnected },
                    set: { on in
                        if on { state.connectStatusLine() } else { state.disconnectStatusLine() }
                    }
                ))
                // Claude Code runs clai from where it is now, so not from a disk image or Downloads.
                .disabled(state.isSample || (!state.statusLineConnected && !AppVersion.isInApplications))
                if let note = state.statusLineNote {
                    WarningText(text: note)
                } else if !state.statusLineConnected && !AppVersion.isInApplications && !state.isSample {
                    Caption("Available once clai is in your Applications folder.")
                } else if state.statusLineConnected && state.claudeLimits == nil {
                    Caption("Waiting for Claude Code: the limits arrive with its next reply in Terminal, on a Pro, Max or Ultra plan.")
                }
            }

            SettingsSection(title: "Organization usage report") {
                OrgSettings(state: state)
            }

            SettingsSection(title: "General") {
                SwitchRow(title: "Open clai at login", isOn: Binding(get: { state.launchAtLogin }, set: { state.setLaunchAtLogin($0) }))
                    .disabled(!AppVersion.isInApplications)
                if !AppVersion.isInApplications {
                    Caption("Available once clai is in your Applications folder.")
                } else if let note = state.loginItemNote {
                    HStack {
                        Caption(note)
                        Button("Open") { state.openLoginItemSettings() }
                            .buttonStyle(.link)
                            .font(.system(size: 11))
                    }
                }
                SwitchRow(title: "Check for updates and current prices", isOn: $state.checkOnline)
                Caption("Once a day clai asks getclai.vercel.app for the price list and GitHub for a newer version. Nothing about your usage is sent.")
            }

            SettingsSection(title: "Where clai looks", caption: "Only token counts, model names and times are read. Never prompts, code or replies.") {
                ForEach(state.sources) { source in
                    SourceRow(source: source)
                }
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("clai \(AppVersion.current) · prices of \(state.priceList.version)")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                HStack(spacing: 14) {
                    LinkButton(title: "getclai.vercel.app", url: "https://getclai.vercel.app")
                    LinkButton(title: "Source code", url: "https://github.com/vcgetter22/clai")
                    LinkButton(title: "Report a problem", url: "https://github.com/vcgetter22/clai/issues")
                    Spacer()
                    Button("Quit clai") { NSApp.terminate(nil) }
                        .controlSize(.small)
                }
            }
        }
        .padding(16)
        .padding(.top, inWindow ? 18 : 0)
    }
}

private struct SettingsSection<Content: View>: View {
    let title: String
    var caption: String?
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 11.5, weight: .semibold))
                .foregroundStyle(.secondary)
            content
            if let caption { Caption(caption) }
        }
    }
}

/// A label on the left and a switch on the right.
private struct SwitchRow: View {
    let title: String
    @Binding var isOn: Bool

    var body: some View {
        HStack {
            Text(title)
                .font(.system(size: 12.5))
            Spacer()
            Toggle(title, isOn: $isOn)
                .labelsHidden()
                .toggleStyle(.switch)
                .controlSize(.small)
        }
    }
}

private struct Caption: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.system(size: 11))
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
    }
}

private struct WarningText: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 11))
            .foregroundStyle(Theme.warning)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// Anthropic's usage report for a Claude Console or Claude Enterprise organization: the key,
/// whose usage counts, and how the last read went.
private struct OrgSettings: View {
    @ObservedObject var state: AppState
    @State private var key = ""
    @State private var email = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let org = state.org {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Connected with key \(org.keyHint)")
                            .font(.system(size: 12.5))
                        Text(readLine)
                            .font(.system(size: 10.5))
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Disconnect") {
                        key = ""
                        email = ""
                        state.disconnectOrg()
                    }
                    .controlSize(.small)
                }
                HStack(spacing: 6) {
                    TextField("Your e-mail address", text: $email)
                        .textFieldStyle(.roundedBorder)
                        .controlSize(.small)
                        .onSubmit { state.setOrgEmail(email) }
                    Button("Apply") { state.setOrgEmail(email) }
                        .controlSize(.small)
                        .disabled(OrgConnection.clean(email) == org.onlyEmail)
                }
                Caption(org.onlyEmail.map { "Counting the usage of \($0) only. Clear the address to count everyone." }
                        ?? "Counting everyone in the organization. Enter your address to count your own usage only.")
            } else {
                SecureField("Admin API key or Analytics API key", text: $key)
                    .textFieldStyle(.roundedBorder)
                    .controlSize(.small)
                    .onSubmit(connect)
                HStack(spacing: 12) {
                    Button(state.orgBusy ? "Checking…" : "Connect", action: connect)
                        .controlSize(.small)
                        .disabled(key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || state.orgBusy || state.isSample)
                    LinkButton(title: "Console admin key", url: "https://platform.claude.com/settings/admin-keys")
                    LinkButton(title: "Enterprise key", url: "https://claude.ai/admin-settings/api-access")
                }
                Caption("Prices what an organization uses beyond this Mac: claude.ai, cloud sessions, Cowork, Claude Design, Slack and the API. Paste an Admin API key (Claude Console) or an Analytics API key (Claude Enterprise). The key stays in clai's folder on this Mac and is used only to read the report from api.anthropic.com every 30 minutes.")
            }
            if let error = state.orgError {
                WarningText(text: error)
            }
        }
        .onAppear { email = state.org?.onlyEmail ?? "" }
    }

    private var readLine: String {
        if state.orgBusy { return "Reading the usage report…" }
        guard let fetched = state.orgFetchedAt else { return "Not read yet" }
        return "Read \(Format.relative(fetched)) · Anthropic reports usage hours late"
    }

    private func connect() {
        state.connectOrg(key: key, onlyEmail: "")
    }
}

private struct PlanPicker: View {
    @ObservedObject var state: AppState
    let vendor: Vendor

    var body: some View {
        let selection = Binding<String>(
            get: { state.plans[vendor] ?? "" },
            set: { state.setPlan($0.isEmpty ? nil : $0, for: vendor) }
        )
        HStack {
            Text(label)
                .font(.system(size: 12.5))
            Spacer()
            Picker(label, selection: selection) {
                Text("None").tag("")
                ForEach(state.priceList.plans.filter { $0.vendor == vendor }) { plan in
                    Text("\(plan.name) · \(Format.usd(plan.monthly))/mo").tag(plan.id)
                }
            }
            .labelsHidden()
            .pickerStyle(.menu)
            .controlSize(.small)
            .frame(width: 210)
        }
    }

    private var label: String {
        switch vendor {
        case .anthropic: return "Claude"
        case .openai: return "ChatGPT"
        case .google: return "Google AI"
        case .other: return "Other"
        }
    }
}

private struct SourceRow: View {
    let source: SourceStatus

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Circle()
                .fill(source.found ? Theme.color(source.tool) : Color.clear)
                .overlay(Circle().strokeBorder(source.found ? Color.clear : Color.secondary.opacity(0.5)))
                .frame(width: 7, height: 7)
            VStack(alignment: .leading, spacing: 1) {
                Text(source.tool.name)
                    .font(.system(size: 12.5, weight: .medium))
                Text(folder)
                    .font(.system(size: 10.5))
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer()
            Text(source.found ? Format.count(source.requests, "request") : "not found")
                .font(.system(size: 11))
                .monospacedDigit()
                .foregroundStyle(.secondary)
        }
        .help(source.folders.joined(separator: "\n"))
    }

    private var folder: String {
        guard let first = source.folders.first else { return "" }
        return (first as NSString).abbreviatingWithTildeInPath
    }
}

private struct LinkButton: View {
    let title: String
    let url: String

    var body: some View {
        Button(title) {
            if let link = URL(string: url) { NSWorkspace.shared.open(link) }
        }
        .buttonStyle(.link)
        .font(.system(size: 11))
    }
}
