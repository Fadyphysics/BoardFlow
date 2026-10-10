let renderer;
async function typesetEquation(latex) {
    if (!renderer) renderer = (async () => {
        const { mathjax } = require('@mathjax/src/js/mathjax.js');
        const { TeX } = require('@mathjax/src/js/input/tex.js');
        const { SVG } = require('@mathjax/src/js/output/svg.js');
        const { MathJaxTexFont } = require('@mathjax/mathjax-tex-font/js/svg.js');
        const { liteAdaptor } = require('@mathjax/src/js/adaptors/liteAdaptor.js');
        const { RegisterHTMLHandler } = require('@mathjax/src/js/handlers/html.js');
        require('@mathjax/src/js/util/asyncLoad/node.js');
        require('@mathjax/src/js/input/tex/ams/AmsConfiguration.js');
        const adaptor = liteAdaptor();
        RegisterHTMLHandler(adaptor);
        const output = new SVG({ fontCache: 'none', fontData: MathJaxTexFont });
        await output.font.loadDynamicFiles();
        const document = mathjax.document('', {
            InputJax: new TeX({ packages: ['base', 'ams'], formatError: (_jax, error) => { throw error; } }),
            OutputJax: output
        });
        return { adaptor, document };
    })().catch(error => { renderer = null; throw error; });
    if (typeof latex !== 'string' || latex.length > 10000) throw new Error('Invalid equation');
    const { adaptor, document } = await renderer;
    const node = document.convert(latex, { display: true });
    const svg = adaptor.firstChild(node);
    const viewBox = adaptor.getAttribute(svg, 'viewBox').split(/\s+/).map(Number);
    adaptor.setAttribute(svg, 'width', String(viewBox[2] / 1000 * 32));
    adaptor.setAttribute(svg, 'height', String(viewBox[3] / 1000 * 32));
    return adaptor.outerHTML(svg);
}
module.exports = { typesetEquation };
