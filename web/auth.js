<script>
// Injetar modal no body
document.addEventListener("DOMContentLoaded", async () => {
    injectModal();
    const ok = await checkAuth();
    if (!ok) openModal();
});

// Verificar autenticação no servidor
async function checkAuth() {
    try {
        const r = await fetch("/api/auth-check");
        const j = await r.json();
        return j.auth === true;
    } catch(e) {
        return false;
    }
}

// Abrir modal
function openModal() {
    document.getElementById("login-overlay").style.display = "flex";
    document.body.classList.add("blurred");
}

// Fechar modal
function closeModal() {
    document.getElementById("login-overlay").style.display = "none";
    document.body.classList.remove("blurred");
}

// Login
async function doLogin() {
    const password = document.getElementById("login-password").value;
    const r = await fetch("/api/login", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ password })
    });
    const j = await r.json();
    if (j.ok) {
        closeModal();
    } else {
        document.getElementById("login-error").style.display = "block";
    }
}

// Criar modal
function injectModal() {
    const html = `
    <div id="login-overlay">
        <div id="login-box">
            <img src="FlatlanticLogo.jpg" class="login-logo" />
            <h2>Autenticação</h2>
            <input id="login-password" type="password" placeholder="Password">
            <button onclick="doLogin()">Entrar</button>
            <div id="login-error">Password incorreta!</div>
        </div>
    </div>
    `;
    document.body.insertAdjacentHTML("beforeend", html);
}
</script>