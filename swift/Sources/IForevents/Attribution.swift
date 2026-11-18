import Foundation

/// Session attribution (sdks/CONTRACT.md, "Attribution"): the utm
/// parameters, ad click ids and external referring domain a session
/// arrived with, attached as event properties to every event of that
/// session so the IForevents api can split any report by origin
/// (`$channel`, `$source`, `$utm_campaign`, ...).
public enum Attribution {
    /// The utm parameters, attached under their own names.
    public static let utmKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id"]

    /// Ad platform click ids, attached under their own names.
    public static let clickIdKeys = ["gclid", "gbraid", "wbraid", "dclid", "msclkid", "fbclid", "ttclid", "twclid", "li_fat_id", "epik", "sccid", "rdt_cid", "yclid"]

    /// A session ends after this long without an event.
    public static let sessionInterval: TimeInterval = 30 * 60

    private static let maxValue = 512

    /// The attribution of a landing: the utm and click id parameters of
    /// `url` (a custom-scheme deep link or a universal link) plus
    /// `referring_domain` when `referrer` is another host. Empty for a
    /// landing that carries none.
    public static func from(url: URL, referrer: URL? = nil) -> [String: String] {
        var out: [String: String] = [:]
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        for key in utmKeys + clickIdKeys {
            guard let value = items.first(where: { $0.name == key })?.value?.trimmingCharacters(in: .whitespaces), !value.isEmpty else { continue }
            out[key] = String(value.prefix(maxValue))
        }
        let refHost = host(referrer)
        if !refHost.isEmpty, refHost != host(url) { out["referring_domain"] = refHost }
        return out
    }

    /// The attribution of a campaign query string (`utm_source=x&utm_medium=y`).
    public static func from(query: String) -> [String: String] {
        let q = query.hasPrefix("?") ? String(query.dropFirst()) : query
        guard let url = URL(string: "x://x?" + q) else { return [:] }
        return from(url: url)
    }

    private static func host(_ url: URL?) -> String {
        guard let h = url?.host?.lowercased() else { return "" }
        return h.hasPrefix("www.") ? String(h.dropFirst(4)) : h
    }
}

/// The current session's attribution. A landing that carries attribution
/// starts a new one; otherwise it lasts while events keep coming within
/// `Attribution.sessionInterval`, and is dropped after. Not thread safe:
/// the facade only touches it on its serial queue.
public struct AttributionTracker {
    private var props: [String: String] = [:]
    private var lastSeen: Date?
    private let clock: () -> Date

    public init(clock: @escaping () -> Date = Date.init) {
        self.clock = clock
    }

    /// The current attribution, empty for a direct session.
    public var current: [String: String] { props }

    public mutating func touch(_ landing: [String: String] = [:]) {
        let now = clock()
        if !landing.isEmpty {
            props = landing
        } else if let last = lastSeen, now.timeIntervalSince(last) <= Attribution.sessionInterval {
            // The session goes on.
        } else {
            props = [:]
        }
        lastSeen = now
    }

    /// `properties` with the attribution added; the caller's own keys win.
    public mutating func apply(_ properties: Properties, landing: [String: String] = [:]) -> Properties {
        touch(landing)
        guard !props.isEmpty else { return properties }
        var out: Properties = props
        out.merge(properties) { _, new in new }
        return out
    }

    public mutating func clear() {
        props = [:]
        lastSeen = nil
    }
}
