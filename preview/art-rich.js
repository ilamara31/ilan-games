/* Ilan Games — key art, second pass.
 *
 * The first pass drew each game in eight or ten shapes. That reads as a
 * diagram, not as artwork. These scenes are built the way a painter would
 * stack them: sky, city, road, the subject's body, then glass, then chrome,
 * then the lights that sit on top of everything.
 *
 * Loaded after art.js; anything defined here replaces the simpler version.
 */
(function (root) {
  "use strict";
  if (!root.ArcadeArt) return;

  var base = root.ArcadeArt.art;
  var RICH = {};

  /* Every scene shares one lighting model: key light high and behind-left,
     a cool rim along every top edge, a warm bounce from the ground. */
  function wrap(id, sky1, sky2, body) {
    var u = 'x' + id;
    return '<svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" class="art">' +
      '<defs>' +
        '<linearGradient id="sky' + u + '" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="' + sky1 + '"/>' +
          '<stop offset="1" stop-color="' + sky2 + '"/></linearGradient>' +
        '<radialGradient id="vig' + u + '" cx="50%" cy="46%" r="76%">' +
          '<stop offset=".45" stop-color="#000" stop-opacity="0"/>' +
          '<stop offset="1" stop-color="#000" stop-opacity=".62"/></radialGradient>' +
        body.defs +
      '</defs>' +
      '<rect width="400" height="300" fill="url(#sky' + u + ')"/>' +
      body.art +
      '<rect width="400" height="300" fill="url(#vig' + u + ')"/>' +
    '</svg>';
  }

  /* ------------------------------------------------------------------ *
   * GRAND PRIX 3D — a supercar under city neon, three-quarter front.
   * ------------------------------------------------------------------ */
  RICH.f1 = function () {
    var d =
      // paint: hard top light dropping fast into a dark flank
      '<linearGradient id="carxf" x1=".25" y1="0" x2=".4" y2="1">' +
        '<stop offset="0" stop-color="#bfe2ff"/><stop offset=".16" stop-color="#5aa3f5"/>' +
        '<stop offset=".5" stop-color="#1a5cc4"/><stop offset="1" stop-color="#062159"/>' +
      '</linearGradient>' +
      '<linearGradient id="skirtxf" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="#0d3272"/><stop offset="1" stop-color="#030e28"/>' +
      '</linearGradient>' +
      '<linearGradient id="glassxf" x1=".15" y1="0" x2=".7" y2="1">' +
        '<stop offset="0" stop-color="#dff0ff" stop-opacity=".85"/>' +
        '<stop offset=".3" stop-color="#2d548f" stop-opacity=".95"/>' +
        '<stop offset="1" stop-color="#050f22"/></linearGradient>' +
      '<linearGradient id="roadxf" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="#1a2138"/><stop offset="1" stop-color="#070a14"/>' +
      '</linearGradient>' +
      '<radialGradient id="lampxf" cx="50%" cy="50%" r="50%">' +
        '<stop offset="0" stop-color="#fffdf0"/><stop offset=".4" stop-color="#ffe9a8"/>' +
        '<stop offset="1" stop-color="#ffb43a" stop-opacity="0"/></radialGradient>' +
      '<radialGradient id="poolxf" cx="50%" cy="50%" r="50%">' +
        '<stop offset="0" stop-color="#4fa8ff" stop-opacity=".45"/>' +
        '<stop offset="1" stop-color="#4fa8ff" stop-opacity="0"/></radialGradient>' +
      '<linearGradient id="rimxf" x1="0" y1="0" x2="1" y2="0">' +
        '<stop offset="0" stop-color="#8fe3ff" stop-opacity="0"/>' +
        '<stop offset=".4" stop-color="#d8f4ff" stop-opacity=".95"/>' +
        '<stop offset="1" stop-color="#8fe3ff" stop-opacity="0"/></linearGradient>' +
      '<radialGradient id="hubxf" cx="38%" cy="32%" r="70%">' +
        '<stop offset="0" stop-color="#b9c8e4"/><stop offset="1" stop-color="#2b3550"/>' +
      '</radialGradient>';

    // One wheel, drawn twice. Deep dish, five spokes, a bright rim edge.
    function wheel(cx, cy, r) {
      var sp = '';
      for (var i = 0; i < 5; i++) {
        var a2 = (i * 72 - 90) * Math.PI / 180;
        sp += '<path d="M' + cx + ' ' + cy + ' L' +
              (cx + Math.cos(a2) * (r * 0.62)).toFixed(1) + ' ' +
              (cy + Math.sin(a2) * (r * 0.62)).toFixed(1) + '" stroke="#9fb0d0" ' +
              'stroke-width="' + (r * 0.17).toFixed(1) + '" stroke-linecap="round"/>';
      }
      return '<g>' +
        '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="#070b14"/>' +
        '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" ' +
          'stroke="#1e2942" stroke-width="2"/>' +
        '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r * 0.63).toFixed(1) + '" fill="url(#hubxf)"/>' +
        sp +
        '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r * 0.63).toFixed(1) + '" fill="none" ' +
          'stroke="#cfe0ff" stroke-width="1.6" opacity=".8"/>' +
        '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r * 0.2).toFixed(1) + '" fill="#111a2c"/>' +
      '</g>';
    }

    // The silhouette. Long nose, cab pushed back, roof barely above the
    // shoulder line — the proportions are what make it read as a supercar
    // rather than a hatchback.
    var SIL = 'M62 208 L104 190 C134 176 162 168 190 163 L216 144 L254 142 ' +
              'L292 154 C318 162 340 174 350 188 L354 204 L352 220 L64 220 Z';

    var a =
      '<g data-d="1">' +
        '<ellipse cx="210" cy="176" rx="220" ry="62" fill="#5b2a8f" opacity=".45"/>' +
        '<ellipse cx="120" cy="184" rx="130" ry="44" fill="#b8368f" opacity=".28"/>' +
        '<g fill="#0c1230">' +
          '<rect x="8" y="96" width="30" height="86"/><rect x="42" y="72" width="22" height="110"/>' +
          '<rect x="70" y="110" width="34" height="72"/><rect x="112" y="60" width="26" height="122"/>' +
          '<rect x="146" y="98" width="20" height="84"/><rect x="250" y="84" width="28" height="98"/>' +
          '<rect x="284" y="104" width="22" height="78"/><rect x="312" y="66" width="30" height="116"/>' +
          '<rect x="350" y="100" width="26" height="82"/>' +
        '</g>' +
        '<g fill="#7fd4ff" opacity=".45">' +
          '<rect x="14" y="106" width="5" height="7"/><rect x="24" y="122" width="5" height="7"/>' +
          '<rect x="48" y="84" width="5" height="7"/><rect x="54" y="106" width="5" height="7"/>' +
          '<rect x="118" y="74" width="5" height="7"/><rect x="126" y="98" width="5" height="7"/>' +
          '<rect x="256" y="96" width="5" height="7"/><rect x="318" y="80" width="5" height="7"/>' +
          '<rect x="330" y="112" width="5" height="7"/><rect x="358" y="116" width="5" height="7"/>' +
        '</g>' +
        '<g opacity=".5">' +
          '<circle cx="62" cy="150" r="9" fill="#ff4fa8"/><circle cx="188" cy="138" r="6" fill="#7fd4ff"/>' +
          '<circle cx="292" cy="144" r="11" fill="#c47bff"/><circle cx="352" cy="154" r="7" fill="#ffb43a"/>' +
        '</g>' +
      '</g>' +

      '<g data-d="2">' +
        '<path d="M0 184 H400 V300 H0z" fill="url(#roadxf)"/>' +
        '<path d="M0 184 H400" stroke="#2d3a5c" stroke-width="2"/>' +
        '<g stroke-linecap="round">' +
          '<path d="M4 202 h44" stroke="#3f4e78" stroke-width="2"/>' +
          '<path d="M310 198 h60" stroke="#3f4e78" stroke-width="2"/>' +
          '<path d="M14 250 h78" stroke="#66799f" stroke-width="3"/>' +
          '<path d="M300 256 h94" stroke="#66799f" stroke-width="3"/>' +
          '<path d="M0 282 h128" stroke="#8fa3d6" stroke-width="4" opacity=".65"/>' +
          '<path d="M272 290 h128" stroke="#8fa3d6" stroke-width="4" opacity=".65"/>' +
        '</g>' +
        '<ellipse cx="196" cy="250" rx="176" ry="40" fill="url(#poolxf)"/>' +
      '</g>' +

      '<g data-d="3">' +
        '<ellipse cx="206" cy="248" rx="134" ry="16" fill="#000" opacity=".66"/>' +

        // rear wing, behind the body
        '<path d="M296 124 h64 l-4 9 h-60z" fill="#0a2048"/>' +
        '<path d="M296 124 h64 l-1.4 3.4 h-62z" fill="#8fd0ff" opacity=".85"/>' +
        '<path d="M308 133 l3 20 M348 133 l-3 20" stroke="#0a2048" stroke-width="6"/>' +

        '<path d="' + SIL + '" fill="url(#carxf)"/>' +
        // rocker and lower flank, in shadow
        '<path d="M70 216 C120 206 260 204 348 212 L352 220 L64 220 Z" fill="url(#skirtxf)"/>' +
        // shoulder crease
        '<path d="M96 192 C160 176 268 178 344 192" fill="none" stroke="#a8d8ff" ' +
              'stroke-width="2" opacity=".5"/>' +
        // door cut
        '<path d="M198 166 C204 182 206 198 204 216" fill="none" stroke="#0a2a60" ' +
              'stroke-width="2" opacity=".7"/>' +

        // glass
        '<path d="M196 166 L218 148 L252 146 L286 157 L282 172 L206 176 Z" fill="url(#glassxf)"/>' +
        '<path d="M206 166 L222 152 L250 151" fill="none" stroke="#eaf6ff" ' +
              'stroke-width="2.4" opacity=".6" stroke-linecap="round"/>' +

        // rim light on the whole upper edge
        '<path d="M104 190 C134 176 162 168 190 163 L216 144 L254 142 L292 154 ' +
                 'C318 162 340 174 350 188" fill="none" stroke="url(#rimxf)" stroke-width="3"/>' +

        // wheel wells, then wheels
        '<circle cx="130" cy="216" r="30" fill="#04070f"/>' +
        '<circle cx="296" cy="216" r="30" fill="#04070f"/>' +
        wheel(130, 216, 27) + wheel(296, 216, 27) +

        // front end: splitter, intake, lamp
        '<path d="M62 208 L58 222 L104 222 L102 210 Z" fill="#050d1c"/>' +
        '<path d="M72 210 h26 l2 8 h-30z" fill="#0b1e42"/>' +
        '<path d="M96 190 l28 -8 l3 9 l-29 8z" fill="#fff8e0"/>' +
        '<path d="M96 190 l28 -8 l3 9 l-29 8z" fill="none" stroke="#ffd98a" stroke-width="1.4"/>' +
        '<ellipse cx="60" cy="202" rx="46" ry="15" fill="url(#lampxf)" opacity=".7"/>' +
        '<path d="M62 196 L4 182 L4 218 L62 208 Z" fill="url(#lampxf)" opacity=".28"/>' +
        // tail light
        '<path d="M340 190 l12 -2 l2 10 l-14 2z" fill="#ff3a4a"/>' +
        '<ellipse cx="350" cy="194" rx="16" ry="9" fill="#ff3a4a" opacity=".35"/>' +
      '</g>';
    return { defs: d, art: a };
  };

  /* ------------------------------------------------------------------ *
   * SUPER OVER CRICKET — the shot, from behind the bowler's arm.
   * ------------------------------------------------------------------ */
  RICH.cricket = function () {
    var d =
      '<linearGradient id="turfxc" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="#2f8f4a"/><stop offset="1" stop-color="#0d3f22"/>' +
      '</linearGradient>' +
      '<linearGradient id="pitchxc" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="#d9c489"/><stop offset="1" stop-color="#a88c52"/>' +
      '</linearGradient>' +
      '<linearGradient id="batxc" x1="0" y1="0" x2="1" y2="0">' +
        '<stop offset="0" stop-color="#f4e3b8"/><stop offset=".45" stop-color="#d9bd7f"/>' +
        '<stop offset="1" stop-color="#9c7d42"/></linearGradient>' +
      '<linearGradient id="shirtxc" x1="0" y1="0" x2=".6" y2="1">' +
        '<stop offset="0" stop-color="#4a9dff"/><stop offset="1" stop-color="#0d3c8c"/>' +
      '</linearGradient>' +
      '<radialGradient id="flarexc" cx="50%" cy="50%" r="50%">' +
        '<stop offset="0" stop-color="#fff8dc" stop-opacity=".9"/>' +
        '<stop offset="1" stop-color="#fff8dc" stop-opacity="0"/></radialGradient>';

    var a =
      '<g data-d="1">' +
        // floodlit stadium bowl
        '<ellipse cx="200" cy="120" rx="270" ry="86" fill="#0a1f3a"/>' +
        '<ellipse cx="200" cy="118" rx="248" ry="74" fill="#12305a"/>' +
        '<g opacity=".5" fill="#7fd4ff">' +
          '<rect x="40" y="92" width="320" height="4" rx="2"/>' +
          '<rect x="60" y="82" width="280" height="3" rx="1.5"/>' +
        '</g>' +
        '<circle cx="72" cy="52" r="26" fill="url(#flarexc)"/>' +
        '<circle cx="330" cy="46" r="30" fill="url(#flarexc)"/>' +
      '</g>' +
      '<g data-d="2">' +
        '<path d="M0 150 H400 V300 H0z" fill="url(#turfxc)"/>' +
        // mown stripes
        '<g fill="#fff" opacity=".05">' +
          '<path d="M0 150 h60 l-30 150 H0z"/><path d="M120 150 h60 l-20 150 h-60z"/>' +
          '<path d="M250 150 h60 l10 150 h-60z"/>' +
        '</g>' +
        // the pitch running away from us
        '<path d="M142 150 h116 l70 150 H72z" fill="url(#pitchxc)" opacity=".92"/>' +
        '<path d="M150 186 h100 M130 232 h140" stroke="#fff" stroke-width="2.4" opacity=".55"/>' +
        // stumps
        '<g>' +
          '<rect x="186" y="126" width="5" height="34" rx="2.5" fill="#f2e6c8"/>' +
          '<rect x="197" y="126" width="5" height="34" rx="2.5" fill="#f2e6c8"/>' +
          '<rect x="208" y="126" width="5" height="34" rx="2.5" fill="#f2e6c8"/>' +
          '<rect x="184" y="121" width="14" height="4" rx="2" fill="#fff8e0"/>' +
          '<rect x="201" y="121" width="14" height="4" rx="2" fill="#fff8e0"/>' +
        '</g>' +
      '</g>' +
      '<g data-d="3">' +
        '<ellipse cx="150" cy="286" rx="74" ry="14" fill="#000" opacity=".45"/>' +
        // batter, mid drive
        '<g>' +
          // back leg / front leg
          '<path d="M132 284 l6 -54 h20 l-2 54z" fill="#e8eef8"/>' +
          '<path d="M162 284 l16 -48 l18 8 l-18 40z" fill="#e8eef8"/>' +
          '<path d="M128 282 h30 v8 h-32z" fill="#1a2740"/>' +
          '<path d="M172 278 h30 v8 h-32z" fill="#1a2740"/>' +
          // pads
          '<path d="M134 232 h24 v46 h-24z" fill="#f7f9fd"/>' +
          '<path d="M168 236 l18 8 l-16 38 l-18 -8z" fill="#f7f9fd"/>' +
          '<g stroke="#c6d2e4" stroke-width="1.6">' +
            '<path d="M134 246 h24 M134 258 h24 M134 270 h24"/></g>' +
          // torso turning into the shot
          '<path d="M130 178 c24 -12 46 -12 66 2 l-4 56 c-22 10 -44 8 -62 -4z" fill="url(#shirtxc)"/>' +
          '<path d="M134 196 c22 -8 42 -8 58 2" fill="none" stroke="#9fd0ff" stroke-width="2" opacity=".6"/>' +
          // arms
          '<path d="M186 190 l44 -26 l10 14 l-44 28z" fill="url(#shirtxc)"/>' +
          '<path d="M134 192 l-24 22 l12 12 l26 -22z" fill="url(#shirtxc)"/>' +
          // gloves
          '<circle cx="236" cy="166" r="12" fill="#f7f9fd"/>' +
          '<circle cx="122" cy="224" r="11" fill="#f7f9fd"/>' +
          // helmet
          '<path d="M140 156 a26 24 0 0 1 52 0 l-2 16 h-48z" fill="#16325e"/>' +
          '<path d="M140 156 a26 24 0 0 1 52 0" fill="none" stroke="#4a9dff" stroke-width="3"/>' +
          '<rect x="146" y="166" width="42" height="4" rx="2" fill="#c6d2e4"/>' +
          '<rect x="146" y="174" width="42" height="4" rx="2" fill="#c6d2e4"/>' +
          '<path d="M186 150 l16 -6 l4 10 l-16 6z" fill="#1a2740"/>' +
        '</g>' +
        // the bat, blurred through the arc
        '<g transform="rotate(-38 250 150)">' +
          '<rect x="234" y="96" width="30" height="96" rx="9" fill="url(#batxc)"/>' +
          '<rect x="234" y="96" width="11" height="96" rx="6" fill="#fff" opacity=".22"/>' +
          '<rect x="243" y="52" width="13" height="50" rx="6.5" fill="#2b1d10"/>' +
          '<rect x="243" y="52" width="13" height="50" rx="6.5" fill="url(#rimxf)" opacity=".3"/>' +
        '</g>' +
        // ball leaving the bat, with its trail
        '<path d="M300 118 q -36 6 -62 22" fill="none" stroke="#fff" stroke-width="3" ' +
              'opacity=".35" stroke-linecap="round"/>' +
        '<circle cx="306" cy="116" r="13" fill="#d42438"/>' +
        '<path d="M295 111 q11 -5 22 0" fill="none" stroke="#fff" stroke-width="2" opacity=".85"/>' +
        '<ellipse cx="301" cy="110" rx="5" ry="3" fill="#fff" opacity=".5"/>' +
      '</g>';
    return { defs: d, art: a };
  };

  /* ------------------------------------------------------------------ *
   * BASKET SCOOP — the ball at the rim, lit from the floor.
   * ------------------------------------------------------------------ */
  RICH.scoop = function () {
    var d =
      '<linearGradient id="floorxs" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="#8a4f1c"/><stop offset="1" stop-color="#2c1405"/>' +
      '</linearGradient>' +
      '<radialGradient id="ballxs" cx="34%" cy="28%" r="74%">' +
        '<stop offset="0" stop-color="#ffbe63"/><stop offset=".45" stop-color="#f07f14"/>' +
        '<stop offset="1" stop-color="#8a3d00"/></radialGradient>' +
      '<linearGradient id="boardxs" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="#1b2a44" stop-opacity=".95"/>' +
        '<stop offset="1" stop-color="#0a1322" stop-opacity=".95"/></linearGradient>' +
      '<radialGradient id="hotxs" cx="50%" cy="50%" r="50%">' +
        '<stop offset="0" stop-color="#ff9f2e" stop-opacity=".55"/>' +
        '<stop offset="1" stop-color="#ff9f2e" stop-opacity="0"/></radialGradient>';

    var a =
      '<g data-d="1">' +
        '<ellipse cx="200" cy="120" rx="240" ry="80" fill="#2a1a3d" opacity=".7"/>' +
        '<g fill="#3a2a56" opacity=".55">' +
          '<rect x="0" y="40" width="400" height="8" rx="4"/>' +
          '<rect x="20" y="58" width="360" height="6" rx="3"/>' +
        '</g>' +
        '<circle cx="330" cy="62" r="34" fill="url(#hotxs)"/>' +
      '</g>' +
      '<g data-d="2">' +
        // backboard, seen slightly from the side
        '<path d="M236 42 h132 v92 h-132z" fill="url(#boardxs)"/>' +
        '<path d="M236 42 h132 v92 h-132z" fill="none" stroke="#e8462e" stroke-width="4"/>' +
        '<rect x="278" y="84" width="48" height="36" fill="none" stroke="#e8462e" stroke-width="4"/>' +
        '<rect x="366" y="60" width="34" height="10" fill="#33415e"/>' +
        // rim
        '<ellipse cx="302" cy="132" rx="46" ry="12" fill="none" stroke="#ff5a2e" stroke-width="7"/>' +
        '<ellipse cx="302" cy="132" rx="46" ry="12" fill="none" stroke="#ffb07a" stroke-width="2.4"/>' +
        // net
        '<g stroke="#eef2f8" stroke-width="2" opacity=".92" fill="none">' +
          '<path d="M258 136 l10 34 M276 139 l6 34 M302 140 v34 M328 139 l-6 34 M346 136 l-10 34"/>' +
          '<path d="M262 150 q40 14 78 0 M268 164 q34 12 68 0 M274 174 q28 9 56 0"/>' +
        '</g>' +
      '</g>' +
      '<g data-d="3">' +
        '<ellipse cx="160" cy="268" rx="96" ry="18" fill="#000" opacity=".5"/>' +
        // court floor
        '<path d="M0 232 H400 V300 H0z" fill="url(#floorxs)"/>' +
        '<path d="M0 232 H400" stroke="#c98a4a" stroke-width="2" opacity=".5"/>' +
        '<path d="M60 262 q140 -22 280 0" fill="none" stroke="#f0d8a8" stroke-width="3" opacity=".35"/>' +
        // the trail it came in on
        '<path d="M60 246 C92 168 150 132 214 128" fill="none" stroke="#ff9f2e" ' +
              'stroke-width="3" stroke-dasharray="2 12" stroke-linecap="round" opacity=".7"/>' +
        '<ellipse cx="168" cy="176" rx="92" ry="74" fill="url(#hotxs)"/>' +
        // the ball
        '<circle cx="168" cy="176" r="56" fill="url(#ballxs)"/>' +
        '<g stroke="#6b2d00" stroke-width="3.4" fill="none" opacity=".9">' +
          '<path d="M112 176 h112"/><path d="M168 120 v112"/>' +
          '<path d="M128 138 q40 38 0 76"/><path d="M208 138 q-40 38 0 76"/>' +
        '</g>' +
        '<ellipse cx="146" cy="152" rx="22" ry="15" fill="#fff" opacity=".3" ' +
                 'transform="rotate(-26 146 152)"/>' +
        '<circle cx="168" cy="176" r="56" fill="none" stroke="#ffd9a8" stroke-width="2" opacity=".35"/>' +
      '</g>';
    return { defs: d, art: a };
  };

  /* ------------------------------------------------------------------ *
   * PING PONG TOUR — bat and ball over the table, first person.
   * ------------------------------------------------------------------ */
  RICH.pptour = function () {
    var d =
      '<linearGradient id="tblxp" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="#1f6fc0"/><stop offset="1" stop-color="#0a3468"/>' +
      '</linearGradient>' +
      '<radialGradient id="rubxp" cx="34%" cy="28%" r="76%">' +
        '<stop offset="0" stop-color="#ff7d82"/><stop offset=".5" stop-color="#d4203a"/>' +
        '<stop offset="1" stop-color="#6d0c1c"/></radialGradient>' +
      '<linearGradient id="hdlxp" x1="0" y1="0" x2="1" y2="0">' +
        '<stop offset="0" stop-color="#6b4a28"/><stop offset=".4" stop-color="#c49a5e"/>' +
        '<stop offset="1" stop-color="#4a3218"/></linearGradient>' +
      '<radialGradient id="glowxp" cx="50%" cy="50%" r="50%">' +
        '<stop offset="0" stop-color="#ffb03a" stop-opacity=".7"/>' +
        '<stop offset="1" stop-color="#ffb03a" stop-opacity="0"/></radialGradient>';

    var a =
      '<g data-d="1">' +
        '<ellipse cx="200" cy="110" rx="250" ry="80" fill="#12234a"/>' +
        '<g fill="#1d3a6b" opacity=".8">' +
          '<rect x="0" y="52" width="400" height="7" rx="3"/>' +
          '<rect x="30" y="68" width="340" height="5" rx="2.5"/>' +
        '</g>' +
        '<g fill="#7fd4ff" opacity=".28">' +
          '<circle cx="54" cy="96" r="8"/><circle cx="150" cy="88" r="6"/>' +
          '<circle cx="268" cy="92" r="7"/><circle cx="350" cy="84" r="9"/>' +
        '</g>' +
      '</g>' +
      '<g data-d="2">' +
        // table receding
        '<path d="M52 186 H348 L400 300 H0z" fill="url(#tblxp)"/>' +
        '<path d="M52 186 H348 L400 300 H0z" fill="none" stroke="#dbeaff" stroke-width="3" opacity=".8"/>' +
        '<path d="M200 186 V300" stroke="#dbeaff" stroke-width="2.4" opacity=".55"/>' +
        '<path d="M52 186 H348 L352 194 H48z" fill="#2f8ce0" opacity=".9"/>' +
        // net
        '<g>' +
          '<rect x="34" y="166" width="332" height="24" rx="2" fill="#0d2748" opacity=".92"/>' +
          '<rect x="34" y="164" width="332" height="5" rx="2.5" fill="#eaf3ff"/>' +
          '<g stroke="#8fb6e4" stroke-width="1" opacity=".55">' +
            [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15].map(function(i){
              return '<path d="M'+(38+i*22)+' 170 v18"/>'; }).join('') +
          '</g>' +
        '</g>' +
      '</g>' +
      '<g data-d="3">' +
        // ball, mid-flight, with its blur
        '<ellipse cx="118" cy="128" rx="40" ry="26" fill="url(#glowxp)"/>' +
        '<path d="M152 112 q-30 6 -54 20" fill="none" stroke="#ffd9a0" stroke-width="3" ' +
              'opacity=".5" stroke-linecap="round"/>' +
        '<circle cx="118" cy="128" r="19" fill="#ffb03a"/>' +
        '<ellipse cx="110" cy="121" rx="7" ry="5" fill="#fff" opacity=".55"/>' +
        // the bat, three-quarter
        '<g transform="rotate(-28 268 148)">' +
          '<ellipse cx="268" cy="126" rx="58" ry="64" fill="#3a2a16"/>' +
          '<ellipse cx="268" cy="122" rx="54" ry="60" fill="url(#rubxp)"/>' +
          '<ellipse cx="248" cy="96" rx="20" ry="16" fill="#fff" opacity=".2" ' +
                   'transform="rotate(-24 248 96)"/>' +
          '<ellipse cx="268" cy="122" rx="54" ry="60" fill="none" stroke="#ff9aa2" ' +
                   'stroke-width="2" opacity=".4"/>' +
          '<path d="M254 182 h28 l-4 64 a10 10 0 0 1 -20 0z" fill="url(#hdlxp)"/>' +
          '<path d="M254 182 h10 l-3 64 a10 10 0 0 1 -7 0z" fill="#fff" opacity=".16"/>' +
        '</g>' +
      '</g>';
    return { defs: d, art: a };
  };

  /* ---- palettes for the wrapper, per scene ---- */
  var SKY = {
    f1:      ['#1a1040', '#050818'],
    cricket: ['#06132c', '#020814'],
    scoop:   ['#1d0f2e', '#080412'],
    pptour:  ['#081a38', '#020a18']
  };

  root.ArcadeArt.art = function (id) {
    if (RICH[id]) return wrap(id, SKY[id][0], SKY[id][1], RICH[id]());
    return base(id);
  };
})(window);
