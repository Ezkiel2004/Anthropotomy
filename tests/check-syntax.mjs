import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
let scripts=0, modules=0, php=0;
// ES modules (the public pages' scripts) cannot be compiled with vm.Script; Node checks them instead.
const isModule=(code,tag='')=>/\btype=["']?module/i.test(tag)||/^\s*(?:import\s[^(]|export\s)|\bimport\.meta\b/m.test(code);
function checkModule(code,file){
    try{execFileSync(process.execPath,['--input-type=module','--check'],{input:code,stdio:['pipe','pipe','pipe']});}
    catch(error){throw new Error(`Syntax error in module ${file}:\n${error.stderr}`);}
    modules++;
}
for(const dir of ['assets/js','assets/js/explorer','student','teacher','.']){
    for(const name of fs.readdirSync(dir)){
        if(!/\.(js|html)$/.test(name)) continue;
        const file=path.join(dir,name),source=fs.readFileSync(file,'utf8');
        const blocks=name.endsWith('.js')?[{code:source,tag:''}]:[...source.matchAll(/(<script\b[^>]*>)([\s\S]*?)<\/script>/gi)].map(m=>({code:m[2],tag:m[1]})).filter(b=>b.code.trim());
        for(const {code,tag} of blocks){if(isModule(code,tag))checkModule(code,file);else{new vm.Script(code,{filename:file});scripts++;}}
        const markup=source.replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/gi,'$1</script>');
        if(name.endsWith('.html'))for(const match of markup.matchAll(/(?:src|href)="([^"#?]+)(?:[?#][^"]*)?"/g)){
            const ref=match[1];if(/^(?:[a-z]+:|\/\/|\$)/i.test(ref)||ref.includes('${'))continue;
            if(ref.startsWith('/'))continue;
            if(!fs.existsSync(path.resolve(dir,ref)))throw new Error(`Missing local resource: ${file} -> ${ref}`);
        }
    }
}
const phpBinary=process.env.PHP_BINARY||(fs.existsSync('C:/xampp/php/php.exe')?'C:/xampp/php/php.exe':'php');
function lint(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())lint(file);else if(file.endsWith('.php')){execFileSync(phpBinary,['-l',file],{stdio:'pipe'});php++;}}}
for(const dir of ['api','database','tests'])lint(dir);
console.log(`Passed: ${scripts} JavaScript blocks/files, ${modules} ES modules, ${php} PHP files, and static local resource references.`);
