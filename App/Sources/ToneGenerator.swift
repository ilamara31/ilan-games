import AVFoundation

/// The web build made its blips with a WebAudio oscillator; this is the same idea
/// natively — a short sine or square tone with an exponential decay.
///
/// The session is `.ambient`, so the game never interrupts music the player has on.
final class ToneGenerator {

    enum Waveform { case sine, square }

    private let engine = AVAudioEngine()
    private var source: AVAudioSourceNode?
    private let sampleRate: Double = 44_100

    // Voice state, read from the render thread.
    private var phase: Double = 0
    private var phaseStep: Double = 0
    private var remaining: Int = 0
    private var total: Int = 1
    private var waveform: Waveform = .sine
    private let lock = NSLock()

    private var started = false

    func start() {
        guard !started else { return }
        started = true

        try? AVAudioSession.sharedInstance().setCategory(.ambient, mode: .default)
        try? AVAudioSession.sharedInstance().setActive(true)

        let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1)!
        let node = AVAudioSourceNode { [weak self] _, _, frameCount, audioBufferList -> OSStatus in
            guard let self else { return noErr }
            let buffers = UnsafeMutableAudioBufferListPointer(audioBufferList)
            self.lock.lock()
            defer { self.lock.unlock() }

            for frame in 0..<Int(frameCount) {
                var sample: Float = 0
                if self.remaining > 0 {
                    // exponential decay from full to silence across the tone's length
                    let progress = 1.0 - Double(self.remaining) / Double(self.total)
                    let envelope = pow(0.001, progress) * 0.2
                    let raw: Double = self.waveform == .sine
                        ? sin(self.phase)
                        : (sin(self.phase) >= 0 ? 1.0 : -1.0)
                    sample = Float(raw * envelope)
                    self.phase += self.phaseStep
                    if self.phase > 2 * .pi { self.phase -= 2 * .pi }
                    self.remaining -= 1
                }
                for buffer in buffers {
                    let pointer = UnsafeMutableBufferPointer<Float>(buffer)
                    pointer[frame] = sample
                }
            }
            return noErr
        }

        source = node
        engine.attach(node)
        engine.connect(node, to: engine.mainMixerNode, format: format)
        try? engine.start()
    }

    /// Retriggers the single voice — later blips cut off earlier ones, which is
    /// what the original did too.
    func play(frequency: Double, duration: Double, waveform: Waveform) {
        guard started else { return }
        lock.lock()
        self.waveform = waveform
        phase = 0
        phaseStep = 2 * .pi * frequency / sampleRate
        total = max(1, Int(duration * sampleRate))
        remaining = total
        lock.unlock()
    }

    func pause() { engine.pause() }
    func resume() { if started { try? engine.start() } }
}
