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

            SettingsSection(title: "General") {
                Toggle("Open clai at login", isOn: Binding(get: { state.launchAtLogin }, set: { state.setLaunchAtLogin($0) }))
                    .toggleStyle(.switch)
                    .controlSize(.small)
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
                Toggle("Check for updates and current prices", isOn: $state.checkOnline)
                    .toggleStyle(.switch)
                    .controlSize(.small)
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
