import AppKit
import ClaiKit
import SwiftUI

/// The window that drops from the menu bar.
struct PanelView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: 0) {
            PanelHeader()
            ZStack(alignment: .top) {
                switch model.page {
                case .overview:
                    OverviewPage()
                        .transition(.asymmetric(insertion: .move(edge: .leading).combined(with: .opacity), removal: .move(edge: .leading).combined(with: .opacity)))
                case .settings:
                    SettingsPage()
                        .transition(.asymmetric(insertion: .move(edge: .trailing).combined(with: .opacity), removal: .move(edge: .trailing).combined(with: .opacity)))
                }
            }
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.22), value: model.page)
        }
        .frame(width: Metrics.panelWidth)
        .onAppear { model.panelOpened() }
    }
}

// MARK: - Header

struct PanelHeader: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        HStack(spacing: 8) {
            if model.page == .settings {
                Button { model.page = .overview } label: { Image(systemName: "chevron.left") }
                    .buttonStyle(IconButtonStyle())
                    .help("Back")
                Text("Settings")
                    .font(.system(size: 15, weight: .semibold))
            } else {
                LogoMark()
                Text("clai")
                    .font(.system(size: 15, weight: .bold))
                if model.isDemo { Chip(text: "Sample data") }
            }
            Spacer()
            if model.page == .overview {
                if !model.watchedPaths.isEmpty {
                    LiveBadge()
                        .help("Watching \(model.watchedPaths.count == 1 ? "1 folder" : "\(model.watchedPaths.count) folders") of usage logs: \(model.watchedPaths.joined(separator: ", "))")
                }
                Button { Task { await model.refresh() } } label: {
                    if model.isRefreshing {
                        ProgressView().controlSize(.small).scaleEffect(0.75)
                    } else {
                        Image(systemName: "arrow.clockwise")
                    }
                }
                .buttonStyle(IconButtonStyle())
                .disabled(model.isRefreshing || model.isDemo)
                .help("Scan now")
                Button { model.page = .settings } label: { Image(systemName: "gearshape.fill") }
                    .buttonStyle(IconButtonStyle())
                    .help("Settings")
            }
        }
        .padding(.horizontal, Metrics.gutter + 2)
        .padding(.top, 12)
        .padding(.bottom, 10)
    }
}

struct LiveBadge: View {
    var body: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(Theme.accent)
                .frame(width: 6, height: 6)
            Text("Live")
                .font(.system(size: 10.5, weight: .semibold))
                .foregroundStyle(Theme.accent)
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .background(Capsule().fill(Theme.accent.opacity(0.12)))
    }
}

// MARK: - Overview

struct OverviewPage: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 0) {
            Group {
                if let snapshot = model.snapshot {
                    if snapshot.isEmpty {
                        WelcomeView(snapshot: snapshot)
                    } else {
                        OverviewContent(snapshot: snapshot)
                    }
                } else if let message = model.failureMessage {
                    ProblemView(message: message)
                } else {
                    LoadingView()
                }
            }
            .padding(.horizontal, Metrics.gutter)
            PanelFooter()
        }
    }
}

struct OverviewContent: View {
    let snapshot: Snapshot
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 8) {
            if let message = model.actionMessage {
                NoticeView(text: message, tint: Theme.warning) { model.actionMessage = nil }
            } else if let stale = model.staleReason {
                NoticeView(text: "Showing the last good numbers. \(stale)", tint: Theme.warning, onDismiss: nil)
            }
            HeroCard(snapshot: snapshot)
            StatPills(snapshot: snapshot) { model.page = .settings }
            DailyChartCard(snapshot: snapshot)
            BreakdownCard(snapshot: snapshot)
        }
    }
}

struct NoticeView: View {
    let text: String
    let tint: Color
    var onDismiss: (() -> Void)?

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.circle.fill")
                .foregroundStyle(tint)
            Text(text)
                .font(.system(size: 11.5, weight: .medium))
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            if let onDismiss {
                Button(action: onDismiss) { Image(systemName: "xmark") }
                    .buttonStyle(IconButtonStyle())
                    .controlSize(.small)
            }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(tint.opacity(0.12)))
    }
}

// MARK: - First run, loading, problems

/// No usage yet: what clai reads, what it found, and the privacy line.
struct WelcomeView: View {
    let snapshot: Snapshot
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Welcome to clai")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(.white)
                Text("clai reads the token counts your AI tools already write on this Mac and prices them at list rates, so you can see what your usage costs and what your plan is worth.")
                    .font(.system(size: 12.5))
                    .foregroundStyle(.white.opacity(0.9))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.heroFill, in: RoundedRectangle(cornerRadius: Metrics.heroRadius, style: .continuous))

            VStack(alignment: .leading, spacing: 8) {
                SectionTitle(text: "Tools on this Mac")
                ForEach(snapshot.scan?.sources ?? []) { source in
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: source.found ? "checkmark.circle.fill" : "circle.dashed")
                            .foregroundStyle(source.found ? Theme.accent : Color.secondary)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(source.label).font(.system(size: 12.5, weight: .semibold))
                            Text(source.found ? source.summary : "Not found")
                                .font(.system(size: 10.5))
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                                .truncationMode(.middle)
                        }
                    }
                }
                Text(snapshot.foundSources.isEmpty
                     ? "Nothing to read yet. Use Claude Code, Codex CLI, Gemini CLI, OpenCode, Cline or Aider and clai picks it up on its own."
                     : "Found the logs but no usage in them yet. New sessions show up here within seconds.")
                    .font(.system(size: 11.5))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 2)
            }
            .padding(12)
            .platter()

            HStack {
                Button("Scan again") { Task { await model.refresh() } }
                    .buttonStyle(ProminentButtonStyle())
                    .disabled(model.isRefreshing)
                Spacer()
            }
        }
    }
}

struct LoadingView: View {
    var body: some View {
        VStack(spacing: 12) {
            ProgressView()
                .controlSize(.regular)
            Text("Reading your logs…")
                .font(.system(size: 13.5, weight: .semibold))
            Text("The first scan of a busy machine can take a minute. After that clai only reads what is new.")
                .font(.system(size: 11.5))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 36)
        .padding(.horizontal, 24)
        .platter()
    }
}

struct ProblemView: View {
    let message: String
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("clai could not read your usage", systemImage: "exclamationmark.triangle.fill")
                .font(.system(size: 13.5, weight: .semibold))
                .foregroundStyle(Theme.warning)
            Text(message)
                .font(.system(size: 12))
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 8) {
                Button("Try again") { Task { await model.refresh() } }
                    .buttonStyle(ProminentButtonStyle())
                Button("Copy details") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString("clai for Mac \(model.appVersion): \(message)", forType: .string)
                }
                .buttonStyle(SecondaryButtonStyle())
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .platter()
    }
}

// MARK: - Footer

struct MoreGlyph: View {
    var body: some View {
        Image(systemName: "ellipsis")
            .font(.system(size: 12.5, weight: .bold))
            .frame(width: 28, height: 28)
            .background(Circle().fill(Color.primary.opacity(0.055)))
            .contentShape(Circle())
    }
}

struct PanelFooter: View {
    @Environment(AppModel.self) private var model
    @Environment(\.exportRendering) private var exporting

    var body: some View {
        HStack(alignment: .center, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                TimelineView(.periodic(from: .now, by: 30)) { context in
                    Text(statusLine(now: context.date))
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
                if let update = model.availableUpdate {
                    Link("Version \(update.version.description) is out", destination: URL(string: "https://getclai.vercel.app")!)
                        .font(.system(size: 10.5, weight: .semibold))
                } else {
                    Label("Usage data stays on this Mac", systemImage: "lock.fill")
                        .font(.system(size: 10.5, weight: .medium))
                        .foregroundStyle(.tertiary)
                        .labelStyle(.titleAndIcon)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                }
            }
            Spacer(minLength: 4)
            Button { model.openDashboard() } label: {
                Label("Dashboard", systemImage: "chart.bar.xaxis")
            }
            .buttonStyle(ProminentButtonStyle())
            .help("Open the full dashboard in your browser (served from this Mac at 127.0.0.1)")
            if exporting {
                MoreGlyph()
            } else {
                moreMenu
            }
        }
        .padding(.horizontal, Metrics.gutter + 2)
        .padding(.top, 10)
        .padding(.bottom, 12)
    }

    private var moreMenu: some View {
        Menu {
            Button("Scan now") { Task { await model.refresh() } }
                .disabled(model.isDemo)
            Button("Settings…") { model.page = .settings }
            Divider()
            Link("clai website", destination: URL(string: "https://getclai.vercel.app")!)
            Link("Source on GitHub", destination: URL(string: "https://github.com/vcgetter22/clai")!)
            Divider()
            Button("Quit clai") { model.quit() }
                .keyboardShortcut("q")
        } label: {
            MoreGlyph()
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
    }

    private func statusLine(now: Date) -> String {
        if model.isRefreshing { return "Scanning…" }
        guard let updated = model.lastUpdated else { return model.isDemo ? "Sample data" : "Not scanned yet" }
        let when = Format.relative(updated, now: now)
        return when == "just now" ? "Updated just now" : "Updated \(when)"
    }
}
