"""Compile the trusted design template to static React calls, without runtime eval.

Only dotted property bindings, booleans, sc-if and sc-for are accepted. The
desktop renderer ships the generated JS/CSS, never the prototype interpreter.
Python 3 is only needed when editing/rebuilding the design template.
"""
from html.parser import HTMLParser
from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]
VOID = {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}
PROPS = {k.lower():k for k in ('className','htmlFor','onClick','onChange','onBlur','onSubmit','onMouseDown','onKeyDown','autoFocus','autoComplete','maxLength','minLength','spellCheck','inputMode','tabIndex','readOnly','viewBox','strokeWidth','strokeLinecap','strokeLinejoin','strokeDasharray','fillRule','clipRule','preserveAspectRatio')}
PROPS.update({'class':'className','for':'htmlFor'})

class Tree(HTMLParser):
    def __init__(self,source):
        super().__init__(convert_charrefs=True)
        self.root = {'tag':'root','children':[],'attrs':{}}
        self.stack = [self.root]
        self.feed(source)
        assert len(self.stack)==1, 'Unclosed template tags'
    def handle_starttag(self,tag,attrs):
        node = {'tag':tag,'attrs':dict(attrs),'children':[]}
        self.stack[-1]['children'].append(node)
        if tag not in VOID: self.stack.append(node)
    def handle_startendtag(self,tag,attrs):
        self.handle_starttag(tag,attrs)
        if tag not in VOID: self.handle_endtag(tag)
    def handle_endtag(self,tag):
        if tag in VOID: return
        assert self.stack[-1]['tag']==tag, f'Unexpected closing {tag}'
        self.stack.pop()
    def handle_data(self,data):
        if data.strip(): self.stack[-1]['children'].append(data)

def binding(expr,scope):
    expr=expr.strip()
    if expr in ('true','false','null'): return expr
    assert re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*',expr), f'Unsupported binding: {expr}'
    parts=expr.split('.')
    return (parts.pop(0) if parts[0] in scope else 'V') + ''.join('?.'+p for p in parts)

def value(raw,scope):
    if raw is None: return 'true'
    matches=list(re.finditer(r'\{\{(.*?)\}\}',raw))
    if len(matches)==1 and matches[0].span()==(0,len(raw)):
        return binding(matches[0].group(1),scope)
    if not matches: return json.dumps(raw,ensure_ascii=False)
    bits=[]; last=0
    for match in matches:
        if match.start()>last: bits.append(json.dumps(raw[last:match.start()],ensure_ascii=False))
        bits.append('String('+binding(match.group(1),scope)+' ?? "")')
        last=match.end()
    if last<len(raw): bits.append(json.dumps(raw[last:],ensure_ascii=False))
    return '('+' + '.join(bits)+')'

def css_prop(name):
    return re.sub(r'-([a-z])',lambda m:m[1].upper(),name) if not name.startswith('--') else name

def style(raw,scope):
    props=[]
    for item in raw.split(';'):
        if not item.strip(): continue
        name,val=item.split(':',1)
        props.append(json.dumps(css_prop(name.strip()))+':'+value(val.strip(),scope))
    return '{'+','.join(props)+'}'

hover_rules=[]
counter=0
def compile_node(node,scope=()):
    global counter
    if isinstance(node,str): return value(re.sub(r'\s+',' ',node),scope)
    tag=node['tag']; attrs=node['attrs']; counter+=1; key=str(counter)
    if tag=='sc-if':
        if attrs.get('value','').strip() in ('{{ isSplash }}','{{ showPreviewNote }}'): return 'null'
        return '('+value(attrs['value'],scope)+' ? '+fragment(node['children'],scope,key)+' : null)'
    if tag=='sc-for':
        alias=attrs['as']; assert re.fullmatch('[A-Za-z_][A-Za-z0-9_]*',alias)
        return '('+value(attrs['list'],scope)+' || []).map(('+alias+', index) => '+fragment(node['children'],(*scope,alias),'index',raw_key=True)+')'
    assert tag not in ('script','iframe','object','embed','helmet','style','link'), f'Unsupported template tag {tag}'
    props=['key:'+json.dumps(key)]
    for name,raw in attrs.items():
        if name.startswith('hint-'): continue
        if name=='style-hover':
            assert '{{' not in raw, 'Dynamic hover CSS not supported'
            cls='hover-'+key
            hover_rules.append('.'+cls+':hover{'+re.sub(r';?$', '',raw).replace(';','!important;')+'!important}')
            props.append('className:'+json.dumps(cls))
        elif name=='style': props.append('style:'+style(raw,scope))
        else:
            if name.startswith('on'): assert name in PROPS, f'Unsupported event {name}'
            prop=PROPS.get(name,name)
            if name=='spellcheck' and raw in ('true','false'): expr=raw
            else: expr=value(raw,scope)
            props.append(json.dumps(prop)+':'+expr)
    children=[compile_node(child,scope) for child in node['children']]
    return 'E('+json.dumps(tag)+',{'+','.join(props)+'}'+(' ,'+',\n'.join(children) if children else '')+')'

def fragment(children,scope,key,raw_key=False):
    return 'E(React.Fragment,{key:'+ (key if raw_key else json.dumps(key))+'},'+','.join(compile_node(child,scope) for child in children)+')'

tree=Tree((ROOT/'ui-src/app.template.html').read_text(encoding='utf8'))
body=fragment(tree.root['children'],(),'root')
template='// Generated by scripts/build-renderer.py. Edit ui-src/app.template.html.\nfunction renderCoreTemplate(V) { const E=React.createElement; return '+body+'; }\n'
(ROOT/'renderer/template.js').write_text(template,encoding='utf8')
css=(ROOT/'ui-src/base.css').read_text(encoding='utf8')+'\n'+'\n'.join(hover_rules)+'\n'
(ROOT/'renderer/style.css').write_text(css,encoding='utf8')
controller=(ROOT/'ui-src/app-controller.js').read_text(encoding='utf8')
controller=controller.replace('class Component extends React.Component {','class Component extends React.Component {\n  render() { return renderCoreTemplate(this.renderVals()); }',1)
entry='\nif (typeof module !== "undefined" && module.exports) module.exports = {Component,parseLaser,dec,amt};\nelse ReactDOM.createRoot(document.getElementById("core-root")).render(React.createElement(Component));\n'
(ROOT/'renderer/app.js').write_text('// Generated by scripts/build-renderer.py. Edit ui-src/app-controller.js.\n(function(){\n"use strict";\n'+controller+entry+'})();\n',encoding='utf8')
print(f'Compiled {counter} design elements; bundled controller; no runtime compilation.')
