import sys
import threading
import time
import tkinter as tk
import urllib.request
import webbrowser
from tkinter import messagebox

URL = "http://127.0.0.1:8000"


# =====================================================
# SERVIDOR
# =====================================================
def start_server():
    try:
        import uvicorn

        from main import app

        config = uvicorn.Config(
            app,
            host="127.0.0.1",
            port=8000,
            log_level="info",
            access_log=False,
            use_colors=False,
        )

        server = uvicorn.Server(config)
        server.run()

    except Exception as e:
        import traceback

        with open("BOOT_ERROR.log", "a", encoding="utf-8") as f:
            f.write("\n" + "=" * 80 + "\n")
            f.write(str(e) + "\n")
            f.write(traceback.format_exc())
        raise


# =====================================================
# ESPERA SERVER
# =====================================================
def wait_for_server(url: str, timeout: float = 30.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url, timeout=2)
            return True
        except:
            time.sleep(0.5)
    return False


# =====================================================
# UI
# =====================================================
class LauncherApp:
    def __init__(self):
        self.root = tk.Tk()

        # ================= ICONO =================
        try:
            self.root.iconbitmap(
                "C:\\Users\\luisg\\Desktop\\CHESS-TRAINER\\chesstrainer\\icon.ico"
            )  # 👈 tu icono aquí
        except:
            pass

        self.root.title("Chess Trainer")
        self.root.geometry("380x160")
        self.root.resizable(False, False)

        self.message = tk.StringVar(value="Iniciando Chess Trainer...")

        tk.Label(self.root, text="Chess Trainer", font=("Segoe UI", 16, "bold")).pack(
            pady=(12, 4)
        )

        tk.Label(
            self.root,
            text="⚠ NO CIERRES ESTA VENTANA (el servidor se detiene)",
            fg="red",
            font=("Segoe UI", 9, "bold"),
        ).pack(pady=(0, 5))

        tk.Label(self.root, textvariable=self.message, font=("Segoe UI", 10)).pack(
            pady=(0, 8)
        )

        self.open_button = tk.Button(
            self.root,
            text="Abrir en navegador",
            state="disabled",
            command=lambda: webbrowser.open(URL),
        )
        self.open_button.pack(pady=(0, 8))

        tk.Button(self.root, text="Cerrar programa", command=self.safe_exit).pack()

        threading.Thread(target=start_server, daemon=True).start()
        threading.Thread(target=self.poll_server, daemon=True).start()

        # interceptar cierre con X
        self.root.protocol("WM_DELETE_WINDOW", self.safe_exit)

    def safe_exit(self):
        if messagebox.askyesno(
            "Chess Trainer",
            "Si cierras esto, el servidor se detendrá.\n¿Seguro que quieres salir?",
        ):
            self.root.destroy()

    def poll_server(self):
        if wait_for_server(URL):
            self.message.set("Servidor listo. Abriendo navegador...")
            self.open_button.config(state="normal")
            webbrowser.open(URL)
            self.message.set("Chess Trainer está listo.")
        else:
            self.message.set("No se pudo iniciar el servidor.")

    def run(self):
        self.root.mainloop()


if __name__ == "__main__":
    LauncherApp().run()
