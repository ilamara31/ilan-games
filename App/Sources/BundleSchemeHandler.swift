import WebKit

/// Serves the bundled game over a custom scheme instead of `file://`.
/// A file:// origin gets no reliable localStorage in WKWebView, which is where the
/// best score lives; a custom scheme gives the page a real origin, so it persists.
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "stacktower"
    static let host = "game"
    static var startURL: URL { URL(string: "\(scheme)://\(host)/index.html")! }

    private let root: URL

    init(root: URL) {
        self.root = root
    }

    private static let mimeTypes = [
        "html": "text/html; charset=utf-8",
        "js": "text/javascript; charset=utf-8",
        "css": "text/css; charset=utf-8",
        "json": "application/json",
        "png": "image/png",
        "jpg": "image/jpeg",
        "svg": "image/svg+xml",
        "mp3": "audio/mpeg",
        "wav": "audio/wav",
    ]

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else {
            task.didFailWithError(URLError(.badURL))
            return
        }

        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }

        // Resolve inside the bundled www directory, and refuse anything that escapes it.
        let file = root.appendingPathComponent(path).standardizedFileURL
        guard file.path.hasPrefix(root.standardizedFileURL.path),
              let data = try? Data(contentsOf: file) else {
            task.didFailWithError(URLError(.fileDoesNotExist))
            return
        }

        let mime = Self.mimeTypes[file.pathExtension.lowercased()] ?? "application/octet-stream"
        let response = HTTPURLResponse(
            url: url,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: [
                "Content-Type": mime,
                "Content-Length": String(data.count),
                "Cache-Control": "no-cache",
            ]
        )!

        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
