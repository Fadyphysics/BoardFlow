import { parse } from 'mathjs';

export function graphExpression(latex) {
    let input = String(latex || '').trim().replace(/^\$+|\$+$/g, '').replace(/\\(?:left|right)/g, '');
    if (input.length > 1000) return null;
    function group(start) {
        if (input[start] !== '{') throw new Error('Expected group');
        let depth = 1, i = start + 1;
        while (i < input.length && depth) { if (input[i] === '{') depth++; if (input[i] === '}') depth--; i++; }
        if (depth) throw new Error('Unclosed group');
        return { text: input.slice(start + 1, i - 1), end: i };
    }
    try {
        // Innermost groups first, with bounded processing of fractions and roots.
        for (let count = 0; /\\(?:dfrac|tfrac|frac|sqrt)/.test(input) && count < 100; count++) {
            const matches = [...input.matchAll(/\\(dfrac|tfrac|frac|sqrt)\s*/g)];
            const match = matches.at(-1), first = group(match.index + match[0].length);
            let replacement, end = first.end;
            if (match[1] === 'sqrt') replacement = `sqrt(${first.text})`;
            else { while (/\s/.test(input[end] || '') && end < input.length) end++; const second = group(end); replacement = `((${first.text})/(${second.text}))`; end = second.end; }
            input = input.slice(0, match.index) + replacement + input.slice(end);
        }
        input = input.replace(/\\(?:cdot|times)/g, '*').replace(/\\(?:sin|cos|tan|sqrt|log|exp|abs|pi)\b/g, m => m.slice(1))
            .replace(/\\[,!; ]/g, '').replace(/[{}]/g, m => m === '{' ? '(' : ')').replace(/[−–]/g, '-');
        const match = input.match(/^(?:y|f\s*\(x\))\s*=\s*(.+)$/i);
        if (!match) return null;
        const expression = match[1];
        const node = parse(expression);
        let valid = true, count = 0;
        const names = new Set(['x', 'pi', 'e', 'sin', 'cos', 'tan', 'sqrt', 'log', 'exp', 'abs']);
        node.traverse(n => {
            if (++count > 100 || !['OperatorNode','SymbolNode','ConstantNode','FunctionNode','ParenthesisNode'].includes(n.type)) valid = false;
            if (n.isSymbolNode && !names.has(n.name)) valid = false;
            if (n.isOperatorNode && !['+','-','*','/','^'].includes(n.op)) valid = false;
            if (n.isFunctionNode && (!names.has(n.fn.name) || n.args.length !== 1)) valid = false;
            if (n.isConstantNode && (typeof n.value !== 'number' || !Number.isFinite(n.value) || Math.abs(n.value) > 1e6)) valid = false;
        });
        if (!valid) return null;
        const compiled = node.compile();
        return { expression, evaluate: x => { try { const y = compiled.evaluate({ x }); return typeof y === 'number' && Number.isFinite(y) ? y : NaN; } catch { return NaN; } } };
    } catch { return null; }
}

export function createLinkedGraph(fabric, canvas, equation) {
    const formula = graphExpression(equation.boardflowPayload?.latex);
    if (!formula) return null;
    const color = equation.boardflowPayload.inkColor || '#4c6fff';
    const size = 240, objects = [];
    objects.push(new fabric.Rect({left:0,top:0,originX:'left',originY:'top',width:size,height:size,fill:'#ffffff',stroke:'#aab4c6',strokeWidth:1}));
    for (let i = 24; i < size; i += 24) {
        const style = {originX:'left',originY:'top',stroke: i === 120 ? '#64748b' : '#e8ecf2',strokeWidth:1};
        objects.push(new fabric.Line([i,0,i,size],style),new fabric.Line([0,i,size,i],style));
    }
    let segment = [];
    const flush = () => { if (segment.length > 1) objects.push(new fabric.Polyline(segment,{originX:'left',originY:'top',fill:'',stroke:color,strokeWidth:2,strokeLineJoin:'round'})); segment = []; };
    for (let i=0;i<=480;i++) {
        const x = -10+i/24, y = formula.evaluate(x), point = {x:i/2,y:120-y*12};
        if (!Number.isFinite(y) || Math.abs(y)>10 || (segment.length && Math.abs(point.y-segment.at(-1).y)>120)) flush();
        if (Number.isFinite(y) && Math.abs(y)<=10) segment.push(point);
    }
    flush();
    objects.push(new fabric.Textbox(`y = ${formula.expression}\nx: −10…10 · y: −10…10`,{left:4,top:246,originX:'left',originY:'top',width:232,fontSize:12,fill:'#334155',fontFamily:'Arial'}));
    const box = equation.getBoundingRect(), zoom = canvas.getZoom();
    const inverse = fabric.util.invertTransform(canvas.viewportTransform);
    const min = fabric.util.transformPoint(new fabric.Point(16,16),inverse);
    const max = fabric.util.transformPoint(new fabric.Point(canvas.getWidth()-16,canvas.getHeight()-16),inverse);
    const scale = Math.min(1/zoom,(max.x-min.x)/size,(max.y-min.y)/290);
    let left=box.left+box.width+24/zoom, top=box.top;
    if (left+size*scale>max.x) {left=box.left;top=box.top+box.height+24/zoom;}
    return new fabric.Group(objects,{left:Math.max(min.x,Math.min(left,max.x-size*scale)),top:Math.max(min.y,Math.min(top,max.y-290*scale)),
        originX:'left',originY:'top',scaleX:scale,scaleY:scale,boardflowKind:'linked-graph',boardflowLayer:equation.boardflowLayer,
        boardflowPayload:{equationId:equation.boardflowId,expression:formula.expression},boardflowId:crypto.randomUUID()});
}
