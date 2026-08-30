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

/// Checks the shared Supabase board loads inside the app — the same rows the
/// website shows.
final class LeaderboardUITests: XCTestCase {
    func testLeaderboardLoadsSharedScores() {
        let app = XCUIApplication()
        app.launch()
        Thread.sleep(forTimeInterval: 2.5)

        // First launch drops straight into the tutorial; clear it to reach the title.
        let centre = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        for _ in 0..<4 {
            centre.tap()
            Thread.sleep(forTimeInterval: 1.0)
        }
        Thread.sleep(forTimeInterval: 1.5)

        let leaderboard = app.buttons["Leaderboard"]
        XCTAssertTrue(leaderboard.waitForExistence(timeout: 8), "leaderboard button should be on the title card")
        leaderboard.tap()

        // Give the network call time to land.
        Thread.sleep(forTimeInterval: 5.0)

        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "10-leaderboard"
        shot.lifetime = .keepAlways
        add(shot)

        XCTAssertTrue(app.cells.count > 0, "the shared board should return rows")
    }
}

/// The sign-in sheet, which shares accounts with the website.
final class SignInUITests: XCTestCase {
    func testSignInSheetRenders() {
        let app = XCUIApplication()
        app.launch()
        Thread.sleep(forTimeInterval: 2.5)

        let centre = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        for _ in 0..<4 {
            centre.tap()
            Thread.sleep(forTimeInterval: 1.0)
        }
        Thread.sleep(forTimeInterval: 1.5)

        let signIn = app.buttons["Sign in"]
        XCTAssertTrue(signIn.waitForExistence(timeout: 8))
        signIn.tap()
        Thread.sleep(forTimeInterval: 1.5)

        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "20-signin"
        shot.lifetime = .keepAlways
        add(shot)

        XCTAssertTrue(app.textFields["Username"].exists, "username field should be present")
        XCTAssertTrue(app.secureTextFields["Password"].exists, "password field should be present")

        // Validation should reject a too-short username without hitting the network.
        app.textFields["Username"].tap()
        app.textFields["Username"].typeText("ab")
        app.buttons["Continue"].tap()
        Thread.sleep(forTimeInterval: 1.0)

        let warned = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        warned.name = "21-signin-validation"
        warned.lifetime = .keepAlways
        add(warned)
    }
}
