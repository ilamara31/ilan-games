import SpriteKit

protocol GameSceneDelegate: AnyObject {
    func gameSceneDidEndRun(_ scene: GameScene, score: Int, best: Int, isNewBest: Bool)
    func gameSceneDidFinishTutorial(_ scene: GameScene)
}

/// The game. World coordinates are y-up with the tower's base at y = 0; a camera
/// node rides up as the stack grows.
final class GameScene: SKScene {

    enum Mode { case idle, playing, tutorial }

    weak var gameDelegate: GameSceneDelegate?

    private(set) var mode: Mode = .idle
    private(set) var score = 0
    private(set) var best = Scores.best

    // A landed block: left edge, width, and its index up the tower.
    private struct Block { var x: CGFloat; var width: CGFloat }
    private var stack: [Block] = []

    // The block currently sliding above the tower.
    private var current: Block?
    private var direction: CGFloat = 1
    private var blockSpeed: CGFloat = Layout.baseSpeed

    private var combo = 0
    private var tutorialLanded = 0

    private var cameraOffset: CGFloat = 0
    private var shake: CGFloat = 0
    private var flash: CGFloat = 0
    private var lastUpdate: TimeInterval = 0

    // playfield band
    private var playfieldWidth: CGFloat = 0
    private var playfieldX: CGFloat = 0

    /// Everything is sized off a reference phone width. Without this the 480pt
    /// playfield is a narrow ribbon down the middle of an iPad with dead bands
    /// either side, and the blocks look like confetti. Scaling the band, the
    /// block height, the travel speed and the perfect-tolerance together keeps
    /// the game playing exactly the same — only bigger.
    private var uiScale: CGFloat = 1
    private var blockHeight: CGFloat { Layout.blockHeight * uiScale }
    private var perfectTolerance: CGFloat { Layout.perfectTolerance * uiScale }

    private let cam = SKCameraNode()
    private let towerLayer = SKNode()
    private let debrisLayer = SKNode()
    private var backdropNode: SKSpriteNode?
    private var leftBand: SKSpriteNode?
    private var rightBand: SKSpriteNode?
    private var flashNode: SKSpriteNode?
    private let scoreLabel = SKLabelNode(fontNamed: "AvenirNext-Heavy")
    private let comboLabel = SKLabelNode(fontNamed: "AvenirNext-Heavy")
    private let bestLabel = SKLabelNode(fontNamed: "AvenirNext-DemiBold")
    private var coach: CoachBubble?

    private let tone = ToneGenerator()
    private let haptics = Haptics()

    var safeTop: CGFloat = 0
    var safeBottom: CGFloat = 0

    // MARK: - Setup

    override func didMove(to view: SKView) {
        backgroundColor = Palette.backdrop
        scaleMode = .resizeFill
        camera = cam
        addChild(cam)
        addChild(towerLayer)
        addChild(debrisLayer)
        tone.start()
        buildBackdrop()
        buildHUD()
        resetCamera()
    }

    override func didChangeSize(_ oldSize: CGSize) {
        super.didChangeSize(oldSize)
        uiScale = min(1.9, max(1.0, size.width / 440))
        playfieldWidth = min(size.width, Layout.maxPlayfieldWidth * uiScale)
        playfieldX = (size.width - playfieldWidth) / 2
        buildBackdrop()
        layoutHUD()
        resetCamera()
    }

    /// Camera y that puts world y = 0 at `60 + safeBottom` above the screen bottom.
    private var cameraBase: CGFloat { size.height / 2 - 60 * uiScale - safeBottom }

    private func resetCamera() {
        cam.position = CGPoint(x: size.width / 2, y: cameraBase + cameraOffset)
    }

    private func buildBackdrop() {
        backdropNode?.removeFromParent()
        leftBand?.removeFromParent()
        rightBand?.removeFromParent()
        flashNode?.removeFromParent()
        guard size.width > 0, size.height > 0 else { return }

        let sky = SKSpriteNode(texture: SKTexture(image: Self.gradientImage(size: size)))
        sky.zPosition = -100
        cam.addChild(sky)
        backdropNode = sky

        // Dim the area outside the playfield so the band reads as the play area.
        if playfieldX > 0 {
            let make = { (x: CGFloat) -> SKSpriteNode in
                let band = SKSpriteNode(color: UIColor(white: 0, alpha: 0.35),
                                        size: CGSize(width: self.playfieldX, height: self.size.height))
                band.position = CGPoint(x: x, y: 0)
                band.zPosition = -50
                let edge = SKSpriteNode(color: UIColor(white: 1, alpha: 0.08),
                                        size: CGSize(width: 2, height: self.size.height))
                edge.position = CGPoint(x: x > 0 ? -self.playfieldX / 2 : self.playfieldX / 2, y: 0)
                band.addChild(edge)
                return band
            }
            let left = make(-size.width / 2 + playfieldX / 2)
            let right = make(size.width / 2 - playfieldX / 2)
            cam.addChild(left)
            cam.addChild(right)
            leftBand = left
            rightBand = right
        }

        let flashOverlay = SKSpriteNode(color: .white, size: size)
        flashOverlay.alpha = 0
        flashOverlay.zPosition = 500
        cam.addChild(flashOverlay)
        flashNode = flashOverlay
    }

    private static func gradientImage(size: CGSize) -> UIImage {
        UIGraphicsImageRenderer(size: size).image { ctx in
            let colors = [Palette.skyTop.cgColor, Palette.skyBottom.cgColor] as CFArray
            guard let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
                                            colors: colors, locations: [0, 1]) else { return }
            ctx.cgContext.drawLinearGradient(gradient,
                                             start: CGPoint(x: 0, y: 0),
                                             end: CGPoint(x: 0, y: size.height),
                                             options: [])
        }
    }

    private func buildHUD() {
        scoreLabel.fontColor = UIColor(white: 1, alpha: 0.9)
        scoreLabel.zPosition = 400
        scoreLabel.isHidden = true
        // Exposed so VoiceOver can read the score aloud, and so UI tests can assert on it.
        scoreLabel.isAccessibilityElement = true
        cam.addChild(scoreLabel)

        comboLabel.fontColor = Palette.gold
        comboLabel.zPosition = 400
        comboLabel.isHidden = true
        cam.addChild(comboLabel)

        bestLabel.fontColor = Palette.subtitle
        bestLabel.zPosition = 400
        bestLabel.isHidden = true
        cam.addChild(bestLabel)
        layoutHUD()
    }

    private func layoutHUD() {
        scoreLabel.fontSize = 60 * uiScale
        comboLabel.fontSize = 22 * uiScale
        bestLabel.fontSize = 14 * uiScale
        let halfH = size.height / 2
        scoreLabel.position = CGPoint(x: 0, y: halfH - safeTop - 90 * uiScale)
        comboLabel.position = CGPoint(x: 0, y: halfH - safeTop - 120 * uiScale)
        bestLabel.position = CGPoint(x: 0, y: -halfH + safeBottom + 16 * uiScale)
        coach?.layout(in: size, safeTop: safeTop, scale: uiScale)
    }

    func updateSafeArea(top: CGFloat, bottom: CGFloat) {
        safeTop = top
        safeBottom = bottom
        layoutHUD()
        resetCamera()
    }

    // MARK: - Run lifecycle

    func startRun(tutorial: Bool) {
        mode = tutorial ? .tutorial : .playing
        score = 0
        combo = 0
        tutorialLanded = 0
        cameraOffset = 0
        shake = 0
        flash = 0
        blockSpeed = tutorial ? Layout.tutorialSpeed : Layout.baseSpeed
        lastUpdate = 0

        towerLayer.removeAllChildren()
        debrisLayer.removeAllChildren()
        stack.removeAll()

        let width = min(playfieldWidth * 0.5, 260 * uiScale)
        stack.append(Block(x: (size.width - width) / 2, width: width))
        addBlockNode(stack[0], index: 0)

        scoreLabel.isHidden = false
        bestLabel.isHidden = false
        updateLabels()
        resetCamera()

        if tutorial {
            showCoach("Tap anywhere to drop the block right over the one below. Line up 3 to finish!")
        }
        spawnBlock()
    }

    func endRun() {
        mode = .idle
        scoreLabel.isHidden = true
        comboLabel.isHidden = true
        bestLabel.isHidden = true
        dismissCoach()
    }

    private func spawnBlock() {
        guard let top = stack.last else { return }
        current = Block(x: playfieldX + 10 * uiScale, width: top.width)
        direction = 1
        blockSpeed = Layout.baseSpeed + CGFloat(score) * Layout.speedPerBlock
        if mode == .tutorial { blockSpeed = Layout.tutorialSpeed }
        currentNode?.removeFromParent()
        let node = makeBlockNode(width: top.width, index: stack.count, current: true)
        node.position = CGPoint(x: current!.x, y: CGFloat(stack.count) * blockHeight)
        towerLayer.addChild(node)
        currentNode = node
    }

    private var currentNode: SKSpriteNode?

    private func makeBlockNode(width: CGFloat, index: Int, current: Bool = false) -> SKSpriteNode {
        let node = SKSpriteNode(color: Palette.block(index, current: current),
                                size: CGSize(width: width, height: blockHeight))
        node.anchorPoint = CGPoint(x: 0, y: 0)

        let highlight = SKSpriteNode(color: UIColor(white: 1, alpha: current ? 0.18 : 0.14),
                                     size: CGSize(width: width, height: 4))
        highlight.anchorPoint = CGPoint(x: 0, y: 0)
        highlight.position = CGPoint(x: 0, y: blockHeight - 4)
        node.addChild(highlight)

        if !current {
            let shadow = SKSpriteNode(color: UIColor(white: 0, alpha: 0.18),
                                      size: CGSize(width: width, height: 5))
            shadow.anchorPoint = CGPoint(x: 0, y: 0)
            node.addChild(shadow)
        }
        return node
    }

    private func addBlockNode(_ block: Block, index: Int) {
        let node = makeBlockNode(width: block.width, index: index)
        node.position = CGPoint(x: block.x, y: CGFloat(index) * blockHeight)
        towerLayer.addChild(node)
    }

    // MARK: - Input

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard mode != .idle else { return }
        drop()
    }

    private func drop() {
        guard let cur = current, let top = stack.last else { return }

        let left = max(cur.x, top.x)
        let right = min(cur.x + cur.width, top.x + top.width)
        let overlap = right - left

        guard overlap > 0 else {
            spawnDebris(x: cur.x, width: cur.width, index: stack.count, velocityX: direction * 40)
            currentNode?.removeFromParent()
            currentNode = nil
            if mode == .tutorial {
                showCoach("Oops — drop it right over the block below. Try again.")
                spawnBlock()
                return
            }
            gameOver()
            return
        }

        let offset = abs(cur.x - top.x)
        if offset < perfectTolerance {
            combo += 1
            score += 1
            flash = 0.4
            haptics.perfect()
            tone.play(frequency: 500 + Double(min(12, combo)) * 60, duration: 0.07, waveform: .square)
            // A long combo widens the tower back out, pulling you off the brink.
            let width = min(top.width + (combo >= 3 ? 6 : 0), playfieldWidth * 0.6)
            let x = top.x - (width - top.width) / 2
            stack.append(Block(x: x, width: width))
            addBlockNode(stack[stack.count - 1], index: stack.count - 1)
            flashPerfect(x: x, width: width, index: stack.count - 1)
        } else {
            combo = 0
            score += 1
            haptics.landed()
            tone.play(frequency: 320, duration: 0.06, waveform: .sine)
            // Slice the overhang off and let it fall.
            if cur.x < top.x {
                spawnDebris(x: cur.x, width: top.x - cur.x, index: stack.count, velocityX: -60)
            } else {
                spawnDebris(x: right, width: (cur.x + cur.width) - right, index: stack.count, velocityX: 60)
            }
            stack.append(Block(x: left, width: overlap))
            addBlockNode(stack[stack.count - 1], index: stack.count - 1)
        }

        currentNode?.removeFromParent()
        currentNode = nil
        updateLabels()
        spawnBlock()

        if mode == .tutorial {
            tutorialLanded += 1
            if tutorialLanded >= 3 {
                showCoach("Perfect — you're ready!")
                run(.sequence([.wait(forDuration: 0.8), .run { [weak self] in
                    guard let self else { return }
                    self.endRun()
                    Scores.markTutorialSeen()
                    self.gameDelegate?.gameSceneDidFinishTutorial(self)
                }]))
            } else {
                showCoach("Nice! \(tutorialLanded) / 3 — keep stacking!")
            }
        }
    }

    private func gameOver() {
        mode = .idle
        shake = 0.5
        haptics.toppled()
        let isNewBest = score > best
        if isNewBest {
            best = score
            Scores.best = score
        }
        let finalScore = score
        run(.sequence([.wait(forDuration: 0.65), .run { [weak self] in
            guard let self else { return }
            self.endRun()
            self.gameDelegate?.gameSceneDidEndRun(self, score: finalScore, best: self.best, isNewBest: isNewBest)
        }]))
    }

    // MARK: - Effects

    private func spawnDebris(x: CGFloat, width: CGFloat, index: Int, velocityX: CGFloat) {
        guard width > 0.5 else { return }
        let node = SKSpriteNode(color: Palette.block(index),
                                size: CGSize(width: width, height: blockHeight))
        node.anchorPoint = CGPoint(x: 0, y: 0)
        node.position = CGPoint(x: x, y: CGFloat(index) * blockHeight)
        debrisLayer.addChild(node)

        // Tumble away and fade, then clean itself up.
        let drift = SKAction.moveBy(x: velocityX * 1.4, y: -900, duration: 1.4)
        let spin = SKAction.rotate(byAngle: velocityX > 0 ? 1.2 : -1.2, duration: 1.4)
        let fade = SKAction.fadeOut(withDuration: 1.4)
        node.run(.sequence([.group([drift, spin, fade]), .removeFromParent()]))
    }

    private func flashPerfect(x: CGFloat, width: CGFloat, index: Int) {
        let outline = SKShapeNode(rect: CGRect(x: x - 4,
                                               y: CGFloat(index) * blockHeight - 4,
                                               width: width + 8,
                                               height: blockHeight + 8))
        outline.strokeColor = .white
        outline.lineWidth = 3
        outline.fillColor = .clear
        outline.zPosition = 300
        towerLayer.addChild(outline)
        outline.run(.sequence([.fadeOut(withDuration: 0.5), .removeFromParent()]))
    }

    private func updateLabels() {
        scoreLabel.text = "\(score)"
        scoreLabel.accessibilityLabel = "Score \(score)"
        bestLabel.text = "best \(best)"
        if combo >= 2 {
            comboLabel.text = "PERFECT x\(combo)!"
            comboLabel.isHidden = false
        } else {
            comboLabel.isHidden = true
        }
    }

    // MARK: - Coach

    private func showCoach(_ message: String) {
        if coach == nil {
            let bubble = CoachBubble()
            bubble.zPosition = 450
            cam.addChild(bubble)
            coach = bubble
        }
        coach?.setMessage(message, in: size, safeTop: safeTop, scale: uiScale)
        // Nudge the score clear of the bubble while it's up.
        scoreLabel.position = CGPoint(x: 0, y: size.height / 2 - safeTop - 170 * uiScale)
    }

    private func dismissCoach() {
        coach?.removeFromParent()
        coach = nil
        layoutHUD()
    }

    // MARK: - Loop

    override func update(_ currentTime: TimeInterval) {
        let delta = lastUpdate == 0 ? 0 : min(0.04, currentTime - lastUpdate)
        lastUpdate = currentTime

        if mode != .idle, var cur = current, let node = currentNode {
            cur.x += direction * blockSpeed * uiScale * 60 * CGFloat(delta)
            if cur.x < playfieldX + 10 * uiScale {
                cur.x = playfieldX + 10 * uiScale
                direction = 1
            }
            if cur.x + cur.width > playfieldX + playfieldWidth - 10 * uiScale {
                cur.x = playfieldX + playfieldWidth - 10 * uiScale - cur.width
                direction = -1
            }
            current = cur
            node.position.x = cur.x
        }

        // Camera trails the top of the tower.
        let target = max(0, CGFloat(stack.count) * blockHeight - size.height * 0.55)
        cameraOffset += (target - cameraOffset) * min(1, CGFloat(delta) * 6)

        var shakeX: CGFloat = 0
        var shakeY: CGFloat = 0
        if shake > 0 {
            shake = max(0, shake - CGFloat(delta) * 1.5)
            shakeX = .random(in: -1...1) * shake * 10
            shakeY = .random(in: -1...1) * shake * 10
        }
        cam.position = CGPoint(x: size.width / 2 + shakeX, y: cameraBase + cameraOffset + shakeY)

        if flash > 0 {
            flash = max(0, flash - CGFloat(delta) * 2.5)
            flashNode?.alpha = flash * 0.25
        } else {
            flashNode?.alpha = 0
        }
    }

    func pauseAudio() { tone.pause() }
    func resumeAudio() { tone.resume(); haptics.prepare() }
}
