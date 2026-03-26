(function(){
  function ensureTopbarAPI(){
    var api = window.Topbar || {};
    api.setStatus = function(text){ var el=document.getElementById('status'); if(el) el.textContent=text; };
    api.updating  = function(){ var el=document.getElementById('status'); if(el) el.textContent='A atualizar…'; };
    api.updatedNow= function(){ var el=document.getElementById('status'); if(el) el.textContent='Atualizado ' + new Date().toLocaleString(); };
    window.Topbar = api;
  }
  function markActive(){
    var current = document.body && document.body.dataset ? document.body.dataset.page : null;
    if(!current) return; var btn=document.querySelector('.nav .pill[data-link="'+current+'"]'); if(btn) btn.classList.add('active');
  }
  window.__initTopbar = function(){ ensureTopbarAPI(); markActive(); };
})();
