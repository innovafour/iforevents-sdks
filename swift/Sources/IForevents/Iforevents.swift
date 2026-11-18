import Foundation

/// The facade: one `initialize`, then `identify`, `track`, `page`/`screen`,
/// `reset`, `flush` and `shutdown` fan out to every integration in isolation
/// on a private serial queue, so calls never block the caller. Identify
/// traits go to every integration once, on identify, and are not copied
/// into later events (each backend keeps them on the profile); nested
/// dictionaries are flattened with `_`. Mirrors the Flutter `Iforevents`.
public final class Iforevents {
    public typealias Completion = ([IntegrationResult]) -> Void

    private let queue = DispatchQueue(label: "com.iforevents.facade", qos: .utility)
    private var integrations: [Integration]
    private let context: () -> Properties
    private let debug: Bool
    private let onResult: Completion?
    private var traits: Properties = [:]
    private var initialized = false
    private var attribution = AttributionTracker()

    public init(integrations: [Integration] = [], context: @escaping () -> Properties = { DeviceContext.collect() }, debug: Bool = false, onResult: Completion? = nil) {
        self.integrations = integrations
        self.context = context
        self.debug = debug
        self.onResult = onResult
    }

    public var isInitialized: Bool { queue.sync { initialized } }

    /// A copy of the traits remembered from the last identify.
    public var currentTraits: Properties { queue.sync { traits } }

    public func addIntegration(_ integration: Integration) {
        queue.async { self.integrations.append(integration) }
    }

    public func integration(named name: String) -> Integration? {
        queue.sync { integrations.first { $0.name == name } }
    }

    /// Initializes every integration. Failures are reported, never thrown.
    public func initialize(completion: Completion? = nil) {
        queue.async {
            let results = self.fanOut { try $0.initialize() }
            self.initialized = true
            completion?(results)
        }
    }

    public func identify(_ customId: String, traits: Properties = [:], completion: Completion? = nil) {
        queue.async {
            guard !customId.isEmpty, self.ready("identify") else { completion?([]); return }
            var merged = self.safeContext()
            merged.merge(traits) { _, new in new }
            let flat = flatten(merged)
            let event = IdentifyEvent(customId: customId, traits: flat)
            let results = self.fanOut { try $0.identify(event) }
            self.traits = flat
            completion?(results)
        }
    }

    public func track(_ name: String, properties: Properties = [:], completion: Completion? = nil) {
        queue.async {
            guard !name.isEmpty, self.ready("track") else { completion?([]); return }
            let event = TrackEvent(name: name, type: .track, properties: flatten(self.attribution.apply(properties)))
            // Compute first: `completion?(expr)` skips `expr` entirely when completion is nil.
            let results = self.fanOut { try $0.track(event) }
            completion?(results)
        }
    }

    public func page(_ name: String = "page_view", properties: Properties = [:], navigationType: String? = nil, toRoute: String? = nil, previousRoute: String? = nil, completion: Completion? = nil) {
        queue.async {
            guard self.ready("page") else { completion?([]); return }
            let event = PageEvent(name: name, properties: flatten(self.attribution.apply(properties)), navigationType: navigationType, toRoute: toRoute, previousRoute: previousRoute)
            let results = self.fanOut { try $0.page(event) }
            completion?(results)
        }
    }

    /// `page` with mobile naming.
    public func screen(_ name: String, properties: Properties = [:], navigationType: String? = nil, previousRoute: String? = nil, completion: Completion? = nil) {
        page(name, properties: properties, navigationType: navigationType, toRoute: name, previousRoute: previousRoute, completion: completion)
    }

    /// Records an opened deep link or universal link (`onOpenURL`,
    /// `application(_:open:options:)`, `NSUserActivity.webpageURL`): sends
    /// `deep_link_opened` with the URL and starts the session attribution
    /// from its utm parameters and click ids, attached to every event until
    /// 30 minutes pass without one.
    public func trackDeepLink(_ url: URL, referrer: URL? = nil, properties: Properties = [:], completion: Completion? = nil) {
        let landing = Attribution.from(url: url, referrer: referrer)
        queue.async { self.attribution.touch(landing) }
        var props: Properties = ["url": url.absoluteString]
        if let referrer = referrer { props["referrer"] = referrer.absoluteString }
        props.merge(properties) { _, new in new }
        track("deep_link_opened", properties: props, completion: completion)
    }

    /// Sets the session attribution yourself (a campaign you resolved, an
    /// install attribution provider's answer).
    public func setAttribution(_ values: [String: String]) {
        queue.async { self.attribution.touch(values) }
    }

    /// Forgets the user in every integration (logout).
    public func reset(completion: Completion? = nil) {
        queue.async {
            guard self.ready("reset") else { completion?([]); return }
            self.attribution.clear()
            let results = self.fanOut { try $0.reset() }
            self.traits = [:]
            completion?(results)
        }
    }

    public func flush(completion: Completion? = nil) {
        queue.async {
            let results = self.fanOut { try $0.flush() }
            completion?(results)
        }
    }

    /// Flushes and releases every integration; the instance is no longer usable.
    public func shutdown(completion: Completion? = nil) {
        queue.async {
            let results = self.fanOut { try $0.shutdown() }
            self.initialized = false
            completion?(results)
        }
    }

    /// Blocks until every call queued so far has run (tests, app termination).
    public func wait() {
        queue.sync {}
    }

    private func ready(_ method: String) -> Bool {
        if initialized { return true }
        if debug { print("[iforevents] \(method) called before initialize; ignored") }
        return false
    }

    private func safeContext() -> Properties {
        context()
    }

    private func fanOut(_ action: (Integration) throws -> Void) -> [IntegrationResult] {
        let results = integrations.map { integration in safeExecute(integration) { try action(integration) } }
        if debug {
            for r in results where !r.success { print("[iforevents] \(r.integration) failed: \(String(describing: r.error))") }
        }
        onResult?(results)
        return results
    }
}
