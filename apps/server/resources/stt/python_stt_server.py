import argparse
import base64
import io
import json
import os
import tempfile
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np


def load_audio_from_wav_bytes(wav_bytes: bytes):
    with wave.open(io.BytesIO(wav_bytes), "rb") as wav_file:
        frames = wav_file.readframes(wav_file.getnframes())
        audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
        sample_rate = wav_file.getframerate()
        channels = wav_file.getnchannels()
        if channels > 1:
            audio = audio.reshape(-1, channels).mean(axis=1)
        return audio, sample_rate


class BaseBackend:
    def transcribe(self, wav_bytes: bytes, language: str, prompt: str) -> str:
        raise NotImplementedError


class FasterWhisperBackend(BaseBackend):
    def __init__(self, model_path: str, device: str, compute_type: str | None):
        from faster_whisper import WhisperModel

        try:
            self.model = WhisperModel(
                model_path,
                device=device,
                compute_type=compute_type
                or ("int8_float16" if device == "cuda" else "int8"),
            )
        except Exception:
            self.model = WhisperModel(model_path, device="cpu", compute_type="int8")

    def transcribe(self, wav_bytes: bytes, language: str, prompt: str) -> str:
        audio, sample_rate = load_audio_from_wav_bytes(wav_bytes)
        segments, _ = self.model.transcribe(
            audio,
            language=None if language == "auto" else language,
            initial_prompt=prompt or None,
            condition_on_previous_text=False,
            vad_filter=False,
            beam_size=1,
            best_of=1,
        )
        return " ".join(
            segment.text.strip() for segment in segments if segment.text
        ).strip()


class ParakeetNemoBackend(BaseBackend):
    def __init__(self, model_path: str, model_ref: str | None, device: str):
        import glob
        import os

        import nemo.collections.asr as nemo_asr
        import torch

        self.nemo_asr = nemo_asr
        if device == "cuda" and torch.cuda.is_available():
            self.device = torch.device("cuda")
        else:
            self.device = torch.device("cpu")

        model = None
        nemo_candidates = glob.glob(
            os.path.join(model_path, "**", "*.nemo"), recursive=True
        )
        if nemo_candidates:
            model = nemo_asr.models.ASRModel.restore_from(
                nemo_candidates[0], map_location=self.device
            )
        else:
            try:
                model = nemo_asr.models.ASRModel.from_pretrained(
                    model_name=model_path, map_location=self.device
                )
            except Exception:
                if not model_ref:
                    raise
                model = nemo_asr.models.ASRModel.from_pretrained(
                    model_name=model_ref, map_location=self.device
                )

        model = model.to(self.device)
        model.freeze()
        self.model = model

    def transcribe(self, wav_bytes: bytes, language: str, prompt: str) -> str:
        del prompt
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as handle:
            handle.write(wav_bytes)
            temp_path = handle.name
        kwargs = {"batch_size": 1, "timestamps": False}
        if language != "auto":
            kwargs["language_id"] = language
        try:
            try:
                output = self.model.transcribe([temp_path], **kwargs)
            except TypeError:
                kwargs.pop("language_id", None)
                output = self.model.transcribe([temp_path], **kwargs)
        finally:
            try:
                os.unlink(temp_path)
            except OSError:
                pass

        if not output:
            return ""
        first = output[0]
        if hasattr(first, "text"):
            return str(first.text).strip()
        if isinstance(first, str):
            return first.strip()
        return str(first).strip()


def create_backend(
    backend: str,
    model_path: str,
    model_ref: str | None,
    device: str,
    compute_type: str | None,
):
    if backend == "faster-whisper":
        return FasterWhisperBackend(model_path, device, compute_type)
    if backend == "parakeet-nemo":
        return ParakeetNemoBackend(model_path, model_ref, device)
    raise ValueError(f"Unsupported backend: {backend}")


class Handler(BaseHTTPRequestHandler):
    backend = None

    def _send_json(self, payload: dict, status: int = 200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send_json({"ok": True})
            return
        self._send_json({"error": "not found"}, 404)

    def do_POST(self):
        if self.path != "/transcribe":
            self._send_json({"error": "not found"}, 404)
            return

        try:
            length = int(self.headers.get("content-length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            wav_bytes = base64.b64decode(payload["audio_base64"])
            text = self.backend.transcribe(
                wav_bytes,
                payload.get("language", "auto"),
                payload.get("prompt", ""),
            )
            self._send_json({"text": text})
        except Exception as error:  # noqa: BLE001
            self._send_json({"error": str(error)}, 500)

    def log_message(self, format: str, *args):
        return


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["serve"])
    parser.add_argument("--backend", required=True)
    parser.add_argument("--model-path", required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--model-ref")
    parser.add_argument("--compute-type")
    args = parser.parse_args()

    backend = create_backend(
        args.backend, args.model_path, args.model_ref, args.device, args.compute_type
    )
    Handler.backend = backend
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.daemon_threads = True

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    thread.join()


if __name__ == "__main__":
    main()
