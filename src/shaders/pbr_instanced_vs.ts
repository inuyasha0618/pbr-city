const src: string = `
#version 300 es
layout (location = 0) in vec3 aPos;
layout (location = 1) in vec3 aNormal;
layout (location = 2) in vec2 aTexCoords;
layout (location = 3) in mat4 aModel;

out vec2 TexCoords;
out vec3 WorldPos;
out vec3 posInView;
// out float distFromView;
out vec3 Normal;

uniform mat4 projection;
uniform mat4 view;

void main()
{
    TexCoords = aTexCoords;
    WorldPos = vec3(aModel * vec4(aPos, 1.0));
    vec3 viewPos = vec3(view * vec4(WorldPos, 1.0));
    posInView = viewPos;
    // distFromView = length(viewPos);
    Normal = mat3(aModel) * aNormal;   
    gl_Position =  projection * view * vec4(WorldPos, 1.0);
}
`.trim();

export default src;