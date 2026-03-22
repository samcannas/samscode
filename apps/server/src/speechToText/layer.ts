import { Layer } from "effect";

import { makeSpeechToText, SpeechToText } from "./service";

export const SpeechToTextLive = Layer.effect(SpeechToText, makeSpeechToText);
