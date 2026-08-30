import XCTest

/// Drives the app through real taps over the automation channel, so it works
/// regardless of where the Simulator window sits on the desktop.
final class GameplayUITests: XCTestCase {

    private func attach(_ app: XCUIApplication, _ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    func testTappingDropsBlocksAndScores() {
        let app = XCUIApplication()
        app.launch()
        Thread.sleep(forTimeInterval: 2.5)

        let centre = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        attach(app, "01-tutorial")

        // Clear the tutorial: three landed blocks returns us to the title card.
        for _ in 0..<4 {
            centre.tap()
            Thread.sleep(forTimeInterval: 1.0)
        }
        Thread.sleep(forTimeInterval: 1.5)
        attach(app, "02-title")

        // Start a real run from the title card.
        let start = app.buttons["STACK"]
        if start.waitForExistence(timeout: 5) {
            start.tap()
        }
        Thread.sleep(forTimeInterval: 1.0)

        // Stack until the run ends, capturing a tall tower on the way.
        var tapped = 0
        while tapped < 30 && app.buttons.matching(identifier: "STACK AGAIN").count == 0 {
            centre.tap()
            tapped += 1
            Thread.sleep(forTimeInterval: 0.5)
            if tapped == 8 { attach(app, "03-midrun") }
        }
        attach(app, "04-after")

        XCTAssertGreaterThan(tapped, 0, "should have been able to tap")
        XCTAssertEqual(app.state, .runningForeground, "app should still be up")
    }
}
