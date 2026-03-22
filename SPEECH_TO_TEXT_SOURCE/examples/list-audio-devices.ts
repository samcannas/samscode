import { NaudiodonAudioCapture } from "../src/index.js";

const capture = new NaudiodonAudioCapture();
const devices = await capture.listInputDevices();
console.log(devices);
