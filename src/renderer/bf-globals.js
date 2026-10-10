// BoardFlow global safety stubs - loads before EVERYTHING else
window.groupRecognitionInk = function (objs) { return objs || []; };
window.selectedNatHit = null;
window.exportPNG = function () {
  try {
    const cv = window.BF?.canvas || window.canvas || null;
    if (cv && cv.toDataURL) {
      const a = document.createElement('a');
      a.download = 'BoardFlow-Board-' + Date.now() + '.png';
      a.href = cv.toDataURL({ format: 'png', multiplier: 2 });
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  } catch (e) { console.warn('exportPNG failed:', e); }
};