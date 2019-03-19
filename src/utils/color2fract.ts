function color2fract(color): Float32Array {
    return new Float32Array([
        color[0] / 255,
        color[1] / 255,
        color[2] / 255,
    ]);
}

export default color2fract;