import XCTest

/// Produces the App Store screenshot set. Runs on whichever simulator is chosen,
/// so the same test yields both the 6.9" iPhone and 13" iPad sets.
final class ScreenshotUITests: XCTestCase {

    private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testCaptureStoreScreenshots() {
        let app = XCUIApplication()
        app.launch()
        Thread.sleep(forTimeInterval: 2.5)

        let centre = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))

        // Clear the tutorial so the coach bubble is out of the way.
        for _ in 0..<4 {
            centre.tap()
            Thread.sleep(forTimeInterval: 1.0)
        }
        Thread.sleep(forTimeInterval: 2.0)
        shot("01-title")

        // A run, captured while the tower is tall and a combo is likely showing.
        if app.buttons["STACK"].waitForExistence(timeout: 6) { app.buttons["STACK"].tap() }
        Thread.sleep(forTimeInterval: 1.0)

        // A steady rhythm stacks cleanly for a long time, which is what makes a
        // good screenshot — the varied rhythm is only for ending a run.
        for i in 0..<26 {
            centre.tap()
            Thread.sleep(forTimeInterval: 0.44)
            if i == 20 { shot("02-tall-tower") }
        }
        shot("03-higher")

        // Let it end so the game-over card with the share button is captured.
        let rhythm: [TimeInterval] = [0.30, 0.55, 0.38, 0.67, 0.33]
        var taps = 0
        while taps < 120 && !app.buttons["Share your score"].exists {
            centre.tap()
            Thread.sleep(forTimeInterval: rhythm[taps % rhythm.count])
            taps += 1
        }
        Thread.sleep(forTimeInterval: 1.0)
        shot("04-gameover")

        // The shared leaderboard.
        if app.buttons["Leaderboard"].waitForExistence(timeout: 6) {
            app.buttons["Leaderboard"].tap()
            Thread.sleep(forTimeInterval: 5.0)
            shot("05-leaderboard")
        }
    }
}
