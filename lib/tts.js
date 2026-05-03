// Renderer-only. Loaded via a <script> tag in renderer/index.html.
(function () {
  function TTSPlayer() {
    this._utterance = null;
    this._lastText = '';
  }

  TTSPlayer.prototype.play = function (text, opts) {
    opts = opts || {};
    const synth = window.speechSynthesis;
    if (!synth) return false;
    // If we're paused on the same text, resume rather than restart.
    if (synth.paused && this._lastText === text && this._utterance) {
      synth.resume();
      return true;
    }
    this.stop();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = opts.rate || 1;
    u.pitch = opts.pitch || 1;
    if (opts.voice) u.voice = opts.voice;
    if (typeof opts.onBoundary === 'function') {
      u.onboundary = (e) => {
        if (e.name === 'word') opts.onBoundary(e.charIndex, e.charLength || 0);
      };
    }
    if (typeof opts.onEnd === 'function') {
      u.onend = () => { this._utterance = null; opts.onEnd(); };
    } else {
      u.onend = () => { this._utterance = null; };
    }
    u.onerror = () => { this._utterance = null; if (opts.onEnd) opts.onEnd(); };
    this._utterance = u;
    this._lastText = text;
    synth.speak(u);
    return true;
  };

  TTSPlayer.prototype.pause = function () {
    const synth = window.speechSynthesis;
    if (synth && synth.speaking && !synth.paused) synth.pause();
  };

  TTSPlayer.prototype.resume = function () {
    const synth = window.speechSynthesis;
    if (synth && synth.paused) synth.resume();
  };

  TTSPlayer.prototype.stop = function () {
    const synth = window.speechSynthesis;
    if (synth) synth.cancel();
    this._utterance = null;
  };

  TTSPlayer.prototype.isSpeaking = function () {
    const synth = window.speechSynthesis;
    return Boolean(synth && synth.speaking);
  };

  TTSPlayer.prototype.isPaused = function () {
    const synth = window.speechSynthesis;
    return Boolean(synth && synth.paused);
  };

  if (typeof window !== 'undefined') window.TTSPlayer = TTSPlayer;
}());
