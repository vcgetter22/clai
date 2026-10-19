import AppKit
import ClaiKit
import SwiftUI

/// Settings live inside the panel, one swipe to the right of the numbers.
struct SettingsPage: View {
    @Environment(AppModel.self) private var model
    @State private var budgetText = ""

    private var snapshot: Snapshot? { model.snapshot }

    var body: some View {
        @Bindable var prefs = model.prefs
        Form {
            Section("Menu bar") {
                Picker("Show", selection: $prefs.menuBarDisplay) {
                    ForEach(MenuBarDisplay.allCases) { display in
                        Text(display.label).tag(display)
                    }
                }
                .pickerStyle(.segmented)
            }

            Section {
                Toggle("Live updates", isOn: Binding(get: { model.prefs.liveUpdates }, set: { model.setPrefersLiveUpdates($0) }))
                Picker("Also refresh every", selection: Binding(get: { model.prefs.refreshMinutes }, set: { model.setRefreshMinutes($0) })) {
                    ForEach(Preferences.refreshChoices, id: \.self) { minutes in
                        Text(minutes == 60 ? "hour" : "\(minutes) min").tag(minutes)
                    }
                }
            } header: {
                Text("Updates")
            } footer: {
                Text("Live updates watch the folders your tools write their logs to and refresh a few seconds after new usage.")
            }

            Section("Your plans") {
                let plans = snapshot?.plans ?? []
                if plans.isEmpty {
                    Text("Declare what you pay for and clai shows what it is worth at list prices.")
                        .foregroundStyle(.secondary)
                }
                ForEach(plans) { plan in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(plan.label)
                            Text("\(Format.usd(plan.priceMonthly)) a month · \(Format.multiple(plan.multiple)) so far")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button("Remove") { Task { await model.removePlan(plan) } }
                            .disabled(model.busy)
                    }
                }
                Menu("Add a plan") {
                    ForEach(Providers.group(snapshot?.planOptions ?? [])) { group in
                        Section(group.label) {
                            ForEach(group.options) { option in
                                Button("\(option.label) · \(Format.usd(option.priceMonthly))/mo") {
                                    Task { await model.setPlan(option) }
                                }
                            }
                        }
                    }
                }
                .disabled(model.busy || (snapshot?.planOptions.isEmpty ?? true))
            }

            Section {
                if let budget = snapshot?.budgets.first {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(budget.name)
                            Text("\(Format.usd(budget.mtdUsd)) used, heading for \(Format.usd(budget.projectedUsd))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(Format.usd(budget.amountUsd)).monospacedDigit()
                        Button("Remove") { Task { await model.removeBudget(budget) } }
                            .disabled(model.busy)
                    }
                }
                HStack {
                    TextField("Amount in USD", text: $budgetText)
                        .textFieldStyle(.roundedBorder)
                        .onSubmit(saveBudget)
                    Button(snapshot?.budgets.isEmpty == false ? "Update" : "Set", action: saveBudget)
                        .disabled(budgetAmount == nil || model.busy)
                }
            } header: {
                Text("Monthly budget")
            } footer: {
                Text("The ring in the green bubble fills as the month's spend approaches it.")
            }

            Section("General") {
                Toggle("Open at login", isOn: Binding(get: { model.launchAtLogin }, set: { model.setLaunchAtLogin($0) }))
                Toggle("Check for updates", isOn: $prefs.checkForUpdates)
                    .help("Asks GitHub once a day whether a newer clai for Mac exists. Sends no usage data.")
                HStack {
                    LabeledContent("Data", value: displayPath(model.dataFolder))
                    Button("Show") { model.revealDataFolder() }
                }
            }

            Section("About") {
                LabeledContent("clai for Mac", value: model.appVersion)
                LabeledContent("Engine", value: snapshot?.engineVersion ?? "-")
                LabeledContent("Prices as of", value: snapshot?.pricingVersion ?? "-")
                Link("getclai.vercel.app", destination: URL(string: "https://getclai.vercel.app")!)
                Link("Source and issues on GitHub", destination: URL(string: "https://github.com/vcgetter22/clai")!)
                Button("Quit clai", role: .destructive) { model.quit() }
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .frame(height: 560)
    }

    private var budgetAmount: Double? {
        let cleaned = budgetText.replacingOccurrences(of: "$", with: "").replacingOccurrences(of: ",", with: "").trimmingCharacters(in: .whitespaces)
        guard let value = Double(cleaned), value > 0, value.isFinite else { return nil }
        return value
    }

    private func saveBudget() {
        guard let amount = budgetAmount else { return }
        budgetText = ""
        Task { await model.setBudget(amount) }
    }

    private func displayPath(_ url: URL) -> String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return url.path.hasPrefix(home) ? "~" + url.path.dropFirst(home.count) : url.path
    }
}
