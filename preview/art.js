/* Ilan Games — key art.
 *
 * One scene per game, built as layered SVG: a lit ground, a subject, and a
 * foreground. Groups carry data-d (1 = far, 3 = near) so a viewer can push
 * them apart under the cursor and the still image becomes a diorama.
 *
 * No emoji. Every scene is drawn from the game's own subject.
 */
(function (root) {
  "use strict";

  var VB = '0 0 400 300';

  // Shared grammar: a vignette ground, a floor glow, a specular sweep.
  function shell(id, c1, c2, glow, body) {
    return '<svg viewBox="' + VB + '" preserveAspectRatio="xMidYMid slice" class="art">' +
      '<defs>' +
        '<linearGradient id="g' + id + '" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="' + c1 + '"/><stop offset="1" stop-color="' + c2 + '"/>' +
        '</linearGradient>' +
        '<radialGradient id="h' + id + '" cx="50%" cy="38%" r="62%">' +
          '<stop offset="0" stop-color="' + glow + '" stop-opacity=".55"/>' +
          '<stop offset="1" stop-color="' + glow + '" stop-opacity="0"/>' +
        '</radialGradient>' +
        '<linearGradient id="s' + id + '" x1="0" y1="0" x2="1" y2="1">' +
          '<stop offset="0" stop-color="#fff" stop-opacity=".22"/>' +
          '<stop offset=".5" stop-color="#fff" stop-opacity="0"/>' +
        '</linearGradient>' +
        // Rendered key art reads the way it does mostly because of what sits ON
        // TOP of the subject: a bloom rising off the floor in the scene's own
        // colour, a cool rim along the top edge as if a light sits behind it,
        // and a vignette pulling the eye to the middle.
        '<radialGradient id="b' + id + '" cx="50%" cy="104%" r="76%">' +
          '<stop offset="0" stop-color="' + glow + '" stop-opacity=".5"/>' +
          '<stop offset="1" stop-color="' + glow + '" stop-opacity="0"/>' +
        '</radialGradient>' +
        '<linearGradient id="r' + id + '" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="#cfe6ff" stop-opacity=".3"/>' +
          '<stop offset=".34" stop-color="#cfe6ff" stop-opacity="0"/>' +
        '</linearGradient>' +
        '<radialGradient id="v' + id + '" cx="50%" cy="48%" r="78%">' +
          '<stop offset=".52" stop-color="#000" stop-opacity="0"/>' +
          '<stop offset="1" stop-color="#000" stop-opacity=".5"/>' +
        '</radialGradient>' +
      '</defs>' +
      '<rect width="400" height="300" fill="url(#g' + id + ')"/>' +
      '<rect width="400" height="300" fill="url(#h' + id + ')"/>' +
      body +
      '<rect width="400" height="300" fill="url(#b' + id + ')" style="mix-blend-mode:screen"/>' +
      '<rect width="400" height="300" fill="url(#r' + id + ')" style="mix-blend-mode:screen"/>' +
      '<rect width="400" height="300" fill="url(#s' + id + ')" style="mix-blend-mode:screen"/>' +
      '<rect width="400" height="300" fill="url(#v' + id + ')"/>' +
    '</svg>';
  }

  // A soft contact shadow — the thing that sells weight more than any gradient.
  function grounded(cx, cy, rx, ry, o) {
    return '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + (ry || rx * 0.26) +
           '" fill="#000" opacity="' + (o || 0.38) + '"/>';
  }

  var SCENES = {

    timeduel: ['#131c36', '#070b18', '#4fd6ff',
      grounded(200, 250, 92, 16) +
      '<g data-d="1"><circle cx="200" cy="150" r="104" fill="none" stroke="#223258"/></g>' +
      '<g data-d="2">' +
        '<circle cx="200" cy="150" r="88" fill="#0c1428" stroke="#2c4272" stroke-width="3"/>' +
        '<circle cx="200" cy="150" r="88" fill="none" stroke="#4fd6ff" stroke-width="5" ' +
          'stroke-dasharray="415 553" stroke-linecap="round" transform="rotate(-90 200 150)" opacity=".95"/>' +
        '<circle cx="200" cy="150" r="70" fill="none" stroke="#1b2a4d"/>' +
      '</g>' +
      '<g data-d="3">' +
        '<rect x="196" y="86" width="8" height="70" rx="4" fill="#ffd45e" transform="rotate(46 200 150)"/>' +
        '<circle cx="200" cy="150" r="11" fill="#ffd45e"/><circle cx="200" cy="150" r="4" fill="#0b1020"/>' +
      '</g>'],

    meme: ['#2a1436', '#100718', '#ff7ad1',
      grounded(200, 252, 96, 15) +
      '<g data-d="1"><rect x="74" y="58" width="252" height="150" rx="16" fill="#1c0f2c" stroke="#3c2455"/></g>' +
      '<g data-d="2">' +
        '<rect x="92" y="72" width="216" height="122" rx="10" fill="#37204f"/>' +
        '<rect x="92" y="72" width="216" height="40" rx="10" fill="#ff7ad1" opacity=".22"/>' +
        '<rect x="112" y="86" width="120" height="11" rx="5" fill="#ffd9f1"/>' +
        '<rect x="112" y="128" width="176" height="9" rx="4" fill="#7a5f96"/>' +
        '<rect x="112" y="148" width="132" height="9" rx="4" fill="#7a5f96"/>' +
      '</g>' +
      '<g data-d="3">' +
        '<path d="M250 196 l16 30 l-44 -10 z" fill="#37204f"/>' +
        '<circle cx="306" cy="78" r="26" fill="#ffb03a"/>' +
        '<path d="M295 76 a11 11 0 0 0 22 0" fill="none" stroke="#5a2f00" stroke-width="4" stroke-linecap="round"/>' +
      '</g>'],

    scoop: ['#3a1a06', '#150800', '#ff9f2e',
      grounded(214, 258, 84, 14) +
      '<g data-d="1">' +
        '<rect x="252" y="46" width="108" height="72" rx="6" fill="#2a1204" stroke="#5c3010" stroke-width="3"/>' +
        '<rect x="288" y="92" width="38" height="4" fill="#e8e2d8"/>' +
      '</g>' +
      '<g data-d="2">' +
        '<path d="M286 96 l-6 34 M328 96 l6 34" stroke="#e8e2d8" stroke-width="3"/>' +
        '<path d="M280 130 q27 14 54 0" fill="none" stroke="#e8e2d8" stroke-width="3"/>' +
      '</g>' +
      '<g data-d="3">' +
        '<circle cx="152" cy="168" r="52" fill="#ff8a1e"/>' +
        '<circle cx="152" cy="168" r="52" fill="none" stroke="#7d3c00" stroke-width="3"/>' +
        '<path d="M100 168h104 M152 116v104 M116 132q36 36 0 72 M188 132q-36 36 0 72" ' +
          'stroke="#7d3c00" stroke-width="3" fill="none"/>' +
        '<ellipse cx="134" cy="148" rx="18" ry="12" fill="#fff" opacity=".22"/>' +
      '</g>'],

    drawrush: ['#0d2a33', '#04111a', '#25e6c8',
      grounded(200, 256, 90, 15) +
      '<g data-d="1"><rect x="70" y="52" width="260" height="162" rx="12" fill="#0a1e28" stroke="#1d4a56"/></g>' +
      '<g data-d="2">' +
        '<path d="M104 176 q36 -74 74 -34 t76 -46" fill="none" stroke="#25e6c8" stroke-width="9" stroke-linecap="round"/>' +
        '<path d="M120 190 q50 -30 96 6" fill="none" stroke="#ff5fa2" stroke-width="7" stroke-linecap="round" opacity=".85"/>' +
      '</g>' +
      '<g data-d="3">' +
        '<g transform="rotate(38 300 196)">' +
          '<rect x="286" y="96" width="28" height="86" rx="4" fill="#ffd45e"/>' +
          '<rect x="286" y="96" width="28" height="86" rx="4" fill="#000" opacity=".12"/>' +
          '<path d="M286 182h28l-14 26z" fill="#ffe9ad"/><path d="M294 198h12l-6 10z" fill="#33231a"/>' +
        '</g>' +
      '</g>'],

    codewords: ['#1a1d33', '#080a16', '#ffd45e',
      grounded(200, 256, 92, 14) +
      '<g data-d="1">' +
        '<rect x="84" y="70" width="70" height="52" rx="7" fill="#232a4a"/>' +
        '<rect x="164" y="70" width="70" height="52" rx="7" fill="#232a4a"/>' +
        '<rect x="244" y="70" width="70" height="52" rx="7" fill="#232a4a"/>' +
      '</g>' +
      '<g data-d="2">' +
        '<rect x="84" y="132" width="70" height="52" rx="7" fill="#ffd45e"/>' +
        '<rect x="164" y="132" width="70" height="52" rx="7" fill="#2b3357"/>' +
        '<rect x="244" y="132" width="70" height="52" rx="7" fill="#c9ccd8"/>' +
        '<rect x="96" y="152" width="46" height="9" rx="4" fill="#6b4b00"/>' +
        '<rect x="256" y="152" width="46" height="9" rx="4" fill="#5b5f6e"/>' +
      '</g>' +
      '<g data-d="3">' +
        '<rect x="164" y="132" width="70" height="52" rx="7" fill="none" stroke="#ffd45e" stroke-width="3"/>' +
        '<circle cx="199" cy="158" r="15" fill="#151a30"/>' +
        '<path d="M186 154 q13 -12 26 0 q-13 13 -26 0z" fill="#ffd45e"/><circle cx="199" cy="157" r="4" fill="#151a30"/>' +
      '</g>'],

    airhockey: ['#0a2440', '#03101f', '#48c8ff',
      '<g data-d="1">' +
        '<rect x="56" y="52" width="288" height="196" rx="18" fill="#0d2f52" stroke="#1d5c92" stroke-width="3"/>' +
        '<line x1="200" y1="52" x2="200" y2="248" stroke="#2d79b8" stroke-width="2"/>' +
        '<circle cx="200" cy="150" r="40" fill="none" stroke="#2d79b8" stroke-width="2"/>' +
      '</g>' +
      '<g data-d="2">' + grounded(140, 178, 30, 9, 0.4) +
        '<circle cx="140" cy="166" r="30" fill="#e94b6a"/><circle cx="140" cy="160" r="30" fill="#ff6b84"/>' +
        '<circle cx="140" cy="160" r="15" fill="#c02b48"/>' +
      '</g>' +
      '<g data-d="3">' + grounded(262, 134, 22, 7, 0.4) +
        '<circle cx="262" cy="124" r="22" fill="#0a1626"/><circle cx="262" cy="120" r="22" fill="#1b2d46"/>' +
        '<ellipse cx="255" cy="113" rx="9" ry="5" fill="#fff" opacity=".25"/>' +
      '</g>'],

    codebreaker: ['#07240f', '#020c06', '#3dff9e',
      grounded(200, 254, 86, 14) +
      '<g data-d="1"><rect x="112" y="46" width="176" height="198" rx="14" fill="#05170c" stroke="#1c5c35"/></g>' +
      '<g data-d="2">' +
        '<rect x="132" y="66" width="136" height="46" rx="7" fill="#031b0d" stroke="#1c5c35"/>' +
        '<text x="200" y="98" font-family="ui-monospace,monospace" font-size="27" fill="#3dff9e" ' +
          'text-anchor="middle" letter-spacing="7">4·7·?</text>' +
      '</g>' +
      '<g data-d="3">' +
        [0,1,2,3,4,5,6,7,8].map(function (i) {
          var x = 136 + (i % 3) * 46, y = 130 + Math.floor(i / 3) * 38;
          return '<rect x="' + x + '" y="' + y + '" width="38" height="30" rx="6" fill="' +
                 (i === 4 ? '#3dff9e' : '#0d3a1f') + '"/>';
        }).join('') +
      '</g>'],

    thisorthat: ['#241033', '#0a0414', '#ff5f7e',
      '<g data-d="1">' +
        '<path d="M0 0h190l-30 300H0z" fill="#3b1030"/>' +
        '<path d="M210 0h190v300H240z" fill="#10203f"/>' +
      '</g>' +
      '<g data-d="2">' +
        '<circle cx="98" cy="140" r="46" fill="#ff5f7e" opacity=".9"/>' +
        '<circle cx="300" cy="140" r="46" fill="#4fa8ff" opacity=".9"/>' +
        '<rect x="70" y="208" width="58" height="10" rx="5" fill="#ff5f7e" opacity=".5"/>' +
        '<rect x="272" y="208" width="58" height="10" rx="5" fill="#4fa8ff" opacity=".5"/>' +
      '</g>' +
      '<g data-d="3">' +
        '<circle cx="200" cy="150" r="34" fill="#0a0414" stroke="#ffd45e" stroke-width="3"/>' +
        '<text x="200" y="161" font-family="Georgia,serif" font-size="27" font-weight="700" ' +
          'fill="#ffd45e" text-anchor="middle">VS</text>' +
      '</g>'],

    cricket: ['#0b2a4a', '#04101f', '#4fd6ff',
      grounded(196, 258, 92, 14) +
      '<g data-d="1">' +
        '<rect x="252" y="120" width="8" height="112" rx="4" fill="#d8c08a"/>' +
        '<rect x="272" y="120" width="8" height="112" rx="4" fill="#d8c08a"/>' +
        '<rect x="292" y="120" width="8" height="112" rx="4" fill="#d8c08a"/>' +
        '<rect x="248" y="112" width="56" height="7" rx="3" fill="#efe0b8"/>' +
      '</g>' +
      '<g data-d="2">' +
        '<g transform="rotate(-32 140 170)">' +
          '<rect x="124" y="92" width="32" height="104" rx="8" fill="#e3c88f"/>' +
          '<rect x="124" y="92" width="12" height="104" fill="#fff" opacity=".18"/>' +
          '<rect x="132" y="42" width="16" height="56" rx="8" fill="#3a2a16"/>' +
        '</g>' +
      '</g>' +
      '<g data-d="3">' +
        grounded(206, 208, 20, 6, 0.35) +
        '<circle cx="206" cy="194" r="21" fill="#c8202e"/>' +
        '<path d="M188 188 q18 -8 36 0" fill="none" stroke="#fff" stroke-width="2.4" opacity=".8"/>' +
        '<ellipse cx="198" cy="185" rx="7" ry="4" fill="#fff" opacity=".3"/>' +
      '</g>'],

    handcricket: ['#06302c', '#021211', '#2ee6b6',
      grounded(200, 256, 82, 13) +
      '<g data-d="2">' +
        '<path d="M150 232 v-78 a13 13 0 0 1 26 0 v-34 a13 13 0 0 1 26 0 v34 a13 13 0 0 1 26 0 v20 ' +
          'a13 13 0 0 1 26 0 v58 z" fill="#f0b489"/>' +
        '<path d="M150 232 v-78 a13 13 0 0 1 26 0 v-34 a13 13 0 0 1 26 0 v34 a13 13 0 0 1 26 0 v20 ' +
          'a13 13 0 0 1 26 0 v58 z" fill="#000" opacity=".1"/>' +
      '</g>' +
      '<g data-d="3">' +
        '<circle cx="118" cy="104" r="34" fill="#2ee6b6"/>' +
        '<text x="118" y="117" font-family="Georgia,serif" font-size="38" font-weight="700" ' +
          'fill="#02231d" text-anchor="middle">6</text>' +
      '</g>'],

    catch: ['#1b3206', '#070f02', '#a6e22e',
      grounded(200, 250, 76, 13) +
      '<g data-d="1">' +
        '<circle cx="120" cy="66" r="17" fill="#ff6b7a"/>' +
        '<circle cx="216" cy="44" r="14" fill="#ffd45e"/>' +
        '<circle cx="286" cy="82" r="16" fill="#4fd6ff"/>' +
      '</g>' +
      '<g data-d="2">' +
        '<circle cx="176" cy="126" r="19" fill="#a6e22e"/>' +
        '<circle cx="262" cy="150" r="15" fill="#ff9f2e"/>' +
      '</g>' +
      '<g data-d="3">' +
        '<path d="M124 178 h152 l-20 62 h-112 z" fill="#c98a3c"/>' +
        '<path d="M124 178 h152 l-6 18 h-140 z" fill="#e8a85a"/>' +
        '<path d="M140 196 h120 M146 216 h108" stroke="#8c5a22" stroke-width="4"/>' +
      '</g>'],

    catch2: ['#3a1206', '#140500', '#ff7a2e',
      grounded(200, 250, 76, 13) +
      '<g data-d="1">' +
        '<circle cx="128" cy="62" r="18" fill="#ff4d6a"/>' +
        '<circle cx="272" cy="52" r="16" fill="#a6e22e"/>' +
      '</g>' +
      '<g data-d="2">' +
        '<rect x="180" y="96" width="60" height="16" rx="8" fill="#f0c36d"/>' +
        '<rect x="180" y="112" width="60" height="12" rx="4" fill="#8c4a22"/>' +
        '<rect x="180" y="124" width="60" height="10" rx="5" fill="#5da62e"/>' +
        '<rect x="180" y="134" width="60" height="16" rx="8" fill="#f0c36d"/>' +
      '</g>' +
      '<g data-d="3">' +
        '<path d="M124 178 h152 l-20 62 h-112 z" fill="#c9553c"/>' +
        '<path d="M124 178 h152 l-6 18 h-140 z" fill="#e8785a"/>' +
      '</g>'],

    carrom: ['#3a2410', '#140b04', '#e8b25a',
      '<g data-d="1">' +
        '<rect x="52" y="30" width="296" height="240" rx="10" fill="#7a4e22"/>' +
        '<rect x="72" y="50" width="256" height="200" rx="4" fill="#e0b478"/>' +
        '<circle cx="200" cy="150" r="62" fill="none" stroke="#a87840" stroke-width="2"/>' +
        '<circle cx="86" cy="64" r="13" fill="#2a1a08"/><circle cx="314" cy="64" r="13" fill="#2a1a08"/>' +
        '<circle cx="86" cy="236" r="13" fill="#2a1a08"/><circle cx="314" cy="236" r="13" fill="#2a1a08"/>' +
      '</g>' +
      '<g data-d="2">' +
        '<circle cx="200" cy="150" r="15" fill="#c8202e"/>' +
        '<circle cx="164" cy="128" r="13" fill="#f4e4c4"/><circle cx="238" cy="132" r="13" fill="#3a2a16"/>' +
        '<circle cx="176" cy="176" r="13" fill="#3a2a16"/><circle cx="230" cy="178" r="13" fill="#f4e4c4"/>' +
      '</g>' +
      '<g data-d="3">' + grounded(200, 238, 22, 7, 0.3) +
        '<circle cx="200" cy="230" r="21" fill="#fff8e8"/><circle cx="200" cy="230" r="21" fill="url(#ssparkle)"/>' +
        '<circle cx="200" cy="230" r="9" fill="#e8b25a"/>' +
      '</g>'],

    f1: ['#2a0608', '#0c0203', '#ff2e4d',
      '<g data-d="1">' +
        '<path d="M0 214 L400 178 v122 H0z" fill="#16181d"/>' +
        '<path d="M0 214 L400 178" stroke="#3a3f4a" stroke-width="3"/>' +
        '<path d="M40 244 h56 M150 236 h56 M262 228 h56" stroke="#e8e8e8" stroke-width="6" opacity=".7"/>' +
      '</g>' +
      '<g data-d="2">' + grounded(206, 224, 104, 14, 0.5) +
        '<path d="M74 214 h250 l-14 -34 h-52 l-20 -32 h-74 l-20 32 h-56z" fill="#e01030"/>' +
        '<path d="M74 214 h250 l-6 -14 h-238z" fill="#a80a22"/>' +
        '<path d="M168 150 h64 l14 24 h-92z" fill="#1a1d24"/>' +
        '<rect x="126" y="140" width="148" height="9" rx="4" fill="#1a1d24"/>' +
      '</g>' +
      '<g data-d="3">' +
        '<circle cx="128" cy="214" r="27" fill="#14161b"/><circle cx="128" cy="214" r="12" fill="#5a5f6a"/>' +
        '<circle cx="286" cy="214" r="27" fill="#14161b"/><circle cx="286" cy="214" r="12" fill="#5a5f6a"/>' +
      '</g>'],

    football: ['#06301a', '#02100a', '#4ade80',
      '<g data-d="1">' +
        '<rect x="0" y="176" width="400" height="124" fill="#0d4426"/>' +
        '<rect x="0" y="176" width="400" height="124" fill="url(#sstripe)" opacity=".2"/>' +
        '<rect x="70" y="60" width="260" height="122" rx="4" fill="none" stroke="#eaf6ef" stroke-width="7"/>' +
        '<rect x="70" y="60" width="260" height="122" fill="#ffffff" opacity=".05"/>' +
      '</g>' +
      '<g data-d="2">' +
        '<path d="M78 68 h244 v106 h-244z" fill="none" stroke="#9fc8ae" stroke-width="1" ' +
          'stroke-dasharray="6 6" opacity=".6"/>' +
      '</g>' +
      '<g data-d="3">' + grounded(196, 244, 28, 8, 0.45) +
        '<circle cx="196" cy="226" r="30" fill="#fff"/>' +
        '<path d="M196 202 l16 12 l-6 20 h-20 l-6 -20z" fill="#14181f"/>' +
        '<path d="M172 216 l-4 18 M220 216 l4 18 M186 250 h20" stroke="#14181f" stroke-width="3.5"/>' +
      '</g>'],

    pptour: ['#0a1c3a', '#030a18', '#ff8a3d',
      '<g data-d="1">' +
        '<path d="M40 202 L360 202 L320 286 L80 286z" fill="#12467a"/>' +
        '<path d="M40 202 L360 202 L356 210 L44 210z" fill="#1d6bb0"/>' +
        '<line x1="200" y1="202" x2="200" y2="286" stroke="#eaf2ff" stroke-width="2" opacity=".6"/>' +
      '</g>' +
      '<g data-d="2">' +
        '<rect x="150" y="178" width="100" height="6" rx="3" fill="#eaf2ff" opacity=".9"/>' +
      '</g>' +
      '<g data-d="3">' +
        '<g transform="rotate(-24 250 130)">' +
          '<ellipse cx="250" cy="110" rx="46" ry="52" fill="#c8202e"/>' +
          '<ellipse cx="250" cy="110" rx="38" ry="44" fill="#e8394a"/>' +
          '<rect x="242" y="156" width="17" height="60" rx="8" fill="#3a2a16"/>' +
        '</g>' +
        '<circle cx="128" cy="144" r="18" fill="#ff8a3d"/>' +
        '<ellipse cx="122" cy="138" rx="6" ry="4" fill="#fff" opacity=".4"/>' +
      '</g>'],

    'fruit-arena': ['#12300a', '#050f02', '#a6e22e',
      '<g data-d="1">' +
        '<path d="M-10 90 q120 -50 250 20 t180 30" fill="none" stroke="#a6e22e" stroke-width="3" opacity=".3"/>' +
      '</g>' +
      '<g data-d="2">' +
        '<path d="M96 140 a46 46 0 0 1 92 0z" fill="#ff4d6a"/>' +
        '<path d="M96 146 a46 46 0 0 0 92 0z" fill="#e0304f" transform="translate(10 16)"/>' +
        '<circle cx="288" cy="176" r="38" fill="#ffb03a"/>' +
        '<path d="M288 138 v76" stroke="#d98a1e" stroke-width="3"/>' +
      '</g>' +
      '<g data-d="3">' +
        '<path d="M40 234 L340 66" stroke="#eaf6ef" stroke-width="5" opacity=".9" stroke-linecap="round"/>' +
        '<path d="M40 234 L340 66" stroke="#fff" stroke-width="13" opacity=".16" stroke-linecap="round"/>' +
      '</g>'],

    paper: ['#04281f', '#010e0a', '#22d39a',
      '<g data-d="1">' +
        [0,1,2,3,4,5,6,7].map(function (i) {
          return '<line x1="' + (i * 50) + '" y1="0" x2="' + (i * 50) + '" y2="300" stroke="#0d3d30"/>' +
                 '<line x1="0" y1="' + (i * 44) + '" x2="400" y2="' + (i * 44) + '" stroke="#0d3d30"/>';
        }).join('') +
      '</g>' +
      '<g data-d="2">' +
        '<path d="M100 88 h150 v58 h-52 v56 h-98z" fill="#22d39a" opacity=".85"/>' +
        '<path d="M250 146 h100 v112 h-152 v-56 h52z" fill="#ff5f7e" opacity=".5"/>' +
      '</g>' +
      '<g data-d="3">' +
        '<path d="M100 88 h150 v58 h-52 v56 h-98z" fill="none" stroke="#7dffd4" stroke-width="3"/>' +
        '<circle cx="198" cy="202" r="13" fill="#7dffd4"/>' +
      '</g>'],

    obby: ['#1a0d36', '#070318', '#ff6bd6',
      grounded(200, 264, 100, 13) +
      '<g data-d="1">' +
        '<rect x="42" y="196" width="86" height="22" rx="5" fill="#ff5f7e"/>' +
        '<rect x="152" y="160" width="86" height="22" rx="5" fill="#ffd45e"/>' +
      '</g>' +
      '<g data-d="2">' +
        '<rect x="262" y="124" width="86" height="22" rx="5" fill="#3dff9e"/>' +
        '<rect x="112" y="98" width="86" height="22" rx="5" fill="#4fd6ff"/>' +
      '</g>' +
      '<g data-d="3">' +
        grounded(200, 176, 20, 6, 0.4) +
        '<rect x="180" y="126" width="40" height="44" rx="10" fill="#ff6bd6"/>' +
        '<circle cx="200" cy="112" r="20" fill="#ffd9f1"/>' +
        '<circle cx="193" cy="110" r="3.4" fill="#2a0a20"/><circle cx="207" cy="110" r="3.4" fill="#2a0a20"/>' +
      '</g>'],

    puzzles: ['#1d1040', '#08041a', '#a78bfa',
      grounded(200, 256, 88, 14) +
      '<g data-d="1">' +
        '<rect x="106" y="56" width="188" height="188" rx="14" fill="#241552" stroke="#3d2480"/>' +
      '</g>' +
      '<g data-d="2">' +
        [[0,0,'#a78bfa'],[1,0,'#3d2480'],[2,0,'#4fd6ff'],[0,1,'#3d2480'],[1,1,'#ffd45e'],
         [2,1,'#3d2480'],[0,2,'#3dff9e'],[1,2,'#3d2480'],[2,2,'#ff5f7e']].map(function (c) {
          return '<rect x="' + (120 + c[0] * 56) + '" y="' + (70 + c[1] * 56) + '" width="46" height="46" ' +
                 'rx="9" fill="' + c[2] + '"/>';
        }).join('') +
      '</g>' +
      '<g data-d="3"><rect x="176" y="126" width="46" height="46" rx="9" fill="none" ' +
        'stroke="#fff" stroke-width="3" opacity=".85"/></g>'],

    try: ['#332a04', '#120e01', '#ffd45e',
      '<g data-d="1"><rect x="0" y="222" width="400" height="78" fill="#1c1703"/></g>' +
      '<g data-d="2">' +
        '<path d="M232 222 l20 -38 l20 38z" fill="#ff5f7e"/>' +
        '<path d="M282 222 l20 -38 l20 38z" fill="#ff5f7e"/>' +
        '<rect x="60" y="150" width="72" height="14" rx="7" fill="#4a3d08"/>' +
      '</g>' +
      '<g data-d="3">' +
        grounded(150, 226, 22, 6, 0.4) +
        '<circle cx="150" cy="192" r="30" fill="#ffd45e"/>' +
        '<circle cx="141" cy="186" r="5" fill="#332a04"/><circle cx="160" cy="186" r="5" fill="#332a04"/>' +
        '<path d="M140 202 q10 9 20 0" fill="none" stroke="#332a04" stroke-width="3.4" stroke-linecap="round"/>' +
      '</g>'],

    'anime-tycoon': ['#24063a', '#0a0216', '#c47bff',
      grounded(200, 262, 90, 14) +
      '<g data-d="1">' +
        '<path d="M60 262 l52 -104 h80 l-34 70 h60 l-54 34z" fill="#3d1160" opacity=".8"/>' +
        '<rect x="248" y="150" width="62" height="112" fill="#2c0d48"/>' +
      '</g>' +
      '<g data-d="2">' +
        '<circle cx="200" cy="130" r="54" fill="#c47bff" opacity=".22"/>' +
        '<circle cx="200" cy="130" r="36" fill="#c47bff" opacity=".4"/>' +
      '</g>' +
      '<g data-d="3">' +
        '<circle cx="200" cy="130" r="21" fill="#f3e2ff"/>' +
        '<path d="M200 70 l11 44 l-11 -8 l-11 8z" fill="#c47bff"/>' +
        '<path d="M200 190 l11 -44 l-11 8 l-11 -8z" fill="#c47bff"/>' +
        '<path d="M140 130 l44 11 l-8 -11 l8 -11z" fill="#c47bff"/>' +
        '<path d="M260 130 l-44 11 l8 -11 l-8 -11z" fill="#c47bff"/>' +
      '</g>'],

    tennis: ['#0a2c14', '#030f07', '#d4ff3d',
      '<g data-d="1">' +
        '<path d="M30 300 L130 110 h140 l100 190z" fill="#12502a"/>' +
        '<path d="M30 300 L130 110 h140 l100 190z" fill="none" stroke="#eaf6ef" stroke-width="3" opacity=".7"/>' +
        '<path d="M92 190 h216 M200 110 v190" stroke="#eaf6ef" stroke-width="2.4" opacity=".55"/>' +
      '</g>' +
      '<g data-d="2">' +
        '<g transform="rotate(30 118 148)">' +
          '<ellipse cx="118" cy="128" rx="40" ry="48" fill="none" stroke="#2a1a3d" stroke-width="9"/>' +
          '<ellipse cx="118" cy="128" rx="34" ry="42" fill="#fff" opacity=".07"/>' +
          '<rect x="111" y="172" width="15" height="58" rx="7" fill="#2a1a3d"/>' +
        '</g>' +
      '</g>' +
      '<g data-d="3">' +
        '<circle cx="290" cy="96" r="21" fill="#d4ff3d"/>' +
        '<path d="M272 88 q18 8 36 0 M272 104 q18 -8 36 0" fill="none" stroke="#6b8c14" stroke-width="2.4"/>' +
      '</g>'],

    karate: ['#2c0508', '#0d0203', '#ff3d4d',
      grounded(200, 262, 86, 14) +
      '<g data-d="1">' +
        '<circle cx="200" cy="140" r="98" fill="none" stroke="#5c1018" stroke-width="3"/>' +
        '<circle cx="200" cy="140" r="76" fill="#1a0407"/>' +
      '</g>' +
      '<g data-d="2">' +
        '<path d="M120 178 h160 v26 h-160z" fill="#0d0203"/>' +
        '<path d="M186 178 l-22 44 h30 l-14 -44z" fill="#0d0203"/>' +
        '<path d="M120 178 h160 v8 h-160z" fill="#fff" opacity=".14"/>' +
      '</g>' +
      '<g data-d="3">' +
        '<path d="M156 96 q0 -28 30 -28 h34 q30 0 30 28 v34 q0 28 -30 28 h-34 q-30 0 -30 -28z" fill="#f0b489"/>' +
        '<path d="M156 112 h94" stroke="#c98a5e" stroke-width="3"/>' +
        '<path d="M156 130 h94" stroke="#c98a5e" stroke-width="3"/>' +
      '</g>'],

    stack: ['#061c38', '#020a16', '#4fd6ff',
      grounded(200, 272, 88, 13) +
      '<g data-d="1">' +
        '<path d="M110 250 h180 l-24 26 h-132z" fill="#0d2f52"/>' +
      '</g>' +
      '<g data-d="2">' +
        '<rect x="118" y="212" width="164" height="38" rx="4" fill="#1d6bb0"/>' +
        '<rect x="126" y="174" width="148" height="38" rx="4" fill="#2a86d6"/>' +
        '<rect x="136" y="136" width="128" height="38" rx="4" fill="#4fd6ff"/>' +
      '</g>' +
      '<g data-d="3">' +
        '<rect x="148" y="98" width="104" height="38" rx="4" fill="#9ae9ff"/>' +
        '<rect x="148" y="98" width="104" height="10" rx="4" fill="#fff" opacity=".4"/>' +
      '</g>'],

    archer: ['#2a1c06', '#0d0902', '#ffb03a',
      '<g data-d="1">' +
        '<circle cx="300" cy="140" r="66" fill="#f4f0e4"/><circle cx="300" cy="140" r="50" fill="#e03040"/>' +
        '<circle cx="300" cy="140" r="34" fill="#f4f0e4"/><circle cx="300" cy="140" r="18" fill="#e03040"/>' +
      '</g>' +
      '<g data-d="2">' +
        '<path d="M92 56 q52 84 0 168" fill="none" stroke="#8c5a22" stroke-width="10" stroke-linecap="round"/>' +
        '<path d="M92 56 L128 140 L92 224" fill="none" stroke="#e8e0cc" stroke-width="2.4"/>' +
      '</g>' +
      '<g data-d="3">' +
        '<path d="M124 140 h150" stroke="#c9b48a" stroke-width="5"/>' +
        '<path d="M274 140 l-22 -10 v20z" fill="#e8e0cc"/>' +
        '<path d="M124 140 l-18 -12 v24z" fill="#ffb03a"/>' +
      '</g>'],

    speedclicker: ['#33280a', '#120e02', '#ffe14f',
      '<g data-d="1">' +
        '<circle cx="200" cy="150" r="104" fill="none" stroke="#5c4a10" stroke-width="2"/>' +
        '<circle cx="200" cy="150" r="126" fill="none" stroke="#3d3208" stroke-width="2"/>' +
      '</g>' +
      '<g data-d="2">' +
        '<circle cx="200" cy="150" r="82" fill="#ffe14f" opacity=".16"/>' +
        '<circle cx="200" cy="150" r="82" fill="none" stroke="#ffe14f" stroke-width="5" ' +
          'stroke-dasharray="360 155" stroke-linecap="round" transform="rotate(-90 200 150)"/>' +
      '</g>' +
      '<g data-d="3">' +
        '<circle cx="200" cy="150" r="56" fill="#ffe14f"/>' +
        '<circle cx="200" cy="150" r="56" fill="url(#ssheen)"/>' +
        '<ellipse cx="180" cy="128" rx="20" ry="13" fill="#fff" opacity=".45"/>' +
      '</g>']
  };

  // A couple of scenes reach for shared gradients; define them once, globally.
  var DEFS = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>' +
    '<radialGradient id="ssparkle" cx="34%" cy="30%" r="70%">' +
      '<stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>' +
    '</radialGradient>' +
    '<linearGradient id="ssheen" x1="0" y1="0" x2="0.6" y2="1">' +
      '<stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>' +
    '</linearGradient>' +
    '<pattern id="sstripe" width="40" height="40" patternUnits="userSpaceOnUse">' +
      '<rect width="20" height="40" fill="#fff" fill-opacity=".5"/>' +
    '</pattern>' +
  '</defs></svg>';

  function art(id) {
    var s = SCENES[id];
    if (!s) s = SCENES.timeduel;
    return shell(id.replace(/[^a-z]/g, ''), s[0], s[1], s[2], s[3]);
  }

  function accent(id) { return (SCENES[id] || SCENES.timeduel)[2]; }

  root.ArcadeArt = { art: art, accent: accent, defs: DEFS, has: function (id) { return !!SCENES[id]; } };
})(window);
