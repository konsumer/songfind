#include "Codegen.h"
#include <emscripten/bind.h>
#include <string>

using namespace emscripten;

// Takes float32 PCM at 11025 Hz mono, returns echoprintstring (same format as
// Spotify's pre-computed echoprintstring field: zlib-compressed, base64url-encoded)
std::string computeEchoprint(uintptr_t pcm_ptr, int num_samples) {
    const float* pcm = reinterpret_cast<const float*>(pcm_ptr);
    Codegen codegen(pcm, (unsigned int)num_samples, 0);
    return codegen.getCodeString();
}

EMSCRIPTEN_BINDINGS(echoprint) {
    function("computeEchoprint", &computeEchoprint, allow_raw_pointers());
}
