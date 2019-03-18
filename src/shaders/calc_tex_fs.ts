const src: string = `
#version 300 es
precision mediump float;
in vec2 uv;
out vec4 fragColor;
void main() {
    float albedo = mod(floor(10.0 * uv.y), 2.0);
    float roughness = mix(0.08, 0.735, albedo);
    float metallic = mix(0.9, 0.2, albedo);
    vec3 col = vec3(albedo, roughness, metallic);
    // float col = mod(floor(10.0 * uv.x) + floor(10.0 * uv.y), 2.0);
    fragColor = vec4(col, 1.0);
}
`.trim();

export default src;