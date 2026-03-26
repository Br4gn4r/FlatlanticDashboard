// export.js — utilitários de exportação (CSV/PNG)
(function(){
  const SEP = ';'; // separador CSV (pt-PT)

  function esc(v){
    const s = (v==null? '' : String(v));
    if (s.includes('"') || s.includes('\n') || s.includes('\r') || s.includes(SEP)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function toCSV(headers, rows){
    const head = headers.map(esc).join(SEP);
    const body = rows.map(r => r.map(esc).join(SEP)).join('\n');
    return '\ufeff' + head + (body ? '\n' + body : ''); // BOM p/ Excel
  }

  function download(filename, content, mime){
    const blob = new Blob([content], {type: mime || 'text/csv;charset=utf-8;'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.style.display='none';
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 250);
  }

  function ts(){
    const d=new Date(); const p=n=>String(n).padStart(2,'0');
    return d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+'_'+p(d.getHours())+p(d.getMinutes())+p(d.getSeconds());
  }

  function tableToCSV(table){
    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody') || table;

    const headers = thead
      ? Array.from(thead.querySelectorAll('th')).map(th => th.innerText.trim())
      : Array.from(table.querySelectorAll('tr:first-child td, tr:first-child th')).map(el => el.innerText.trim());

    const rows = [];
    Array.from(tbody.querySelectorAll('tr')).forEach(tr=>{
      const cells = Array.from(tr.querySelectorAll('td'));
      if(!cells.length) return; // ignora linhas sem dados
      rows.push(cells.map(td => td.innerText.replace(/\s+/g,' ').trim()));
    });

    return toCSV(headers, rows);
  }

  function downloadCSVFromTable(table, filenameBase){
    const csv = tableToCSV(table);
    const name = (filenameBase||'export') + '_' + ts() + '.csv';
    download(name, csv, 'text/csv;charset=utf-8;');
  }

  function downloadCSVFromData(headers, rows, filenameBase){
    const csv = toCSV(headers, rows);
    const name = (filenameBase||'dados') + '_' + ts() + '.csv';
    download(name, csv, 'text/csv;charset=utf-8;');
  }

  function downloadPNGFromCanvas(canvas, filenameBase){
    try{
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = (filenameBase||'grafico')+'_'+ts()+'.png';
      a.click();
    }catch(e){
      alert('Não foi possível exportar PNG: ' + e.message);
    }
  }

  // API global
  window.Export = { tableToCSV, downloadCSVFromTable, downloadCSVFromData, downloadPNGFromCanvas };
})();