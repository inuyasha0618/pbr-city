import { mat4, vec3 } from 'gl-matrix'
import * as dat from 'dat.gui';
import RenderLooper from 'render-looper';
import { ShaderProgram, drawCube, drawCubeSmooth, OrbitCamera, drawQuad, drawQuadWithTex, renderSphere, ObjMesh } from './gl-helpers/index';
import { getContext, resizeCvs2Screen, getRadian } from './utils/index';
import background_vs from './shaders/background_vs';
import background_fs from './shaders/background_fs';
import brdf_vs from './shaders/brdf_vs';
import brdf_fs from './shaders/brdf_fs';
import cubemap_vs from './shaders/cubemap_vs';
import equirectangular_to_cubemap_fs from './shaders/equirectangular_to_cubemap_fs';
import irradiance_convolution_fs from './shaders/irradiance_convolution_fs';
import pbr_vs from './shaders/pbr_vs';
import pbr_fs from './shaders/pbr_fs';
import pbr_instanced_vs from './shaders/pbr_instanced_vs';
import prefilter_fs from './shaders/prefilter_fs';
import quad_vs from './shaders/quad_vs';
import calc_tex_fs from './shaders/calc_tex_fs';
import river from './river';

class UIcontroller {
    roughness: number = 0.01;
    mainBuildingScale: number = 1.0;
    mainBuildingMetallic: number = 0.9;
}
const ctrl = new UIcontroller();

window.onload = function() {
    const gui = new dat.GUI();
    gui.add(ctrl, 'roughness', 0.0, 1.0);
    gui.add(ctrl, 'mainBuildingScale', 1.0, 15.0);
    gui.add(ctrl, 'mainBuildingMetallic', 0.0, 1.0);
};

const lightPositions: Array<Float32Array> = [
    new Float32Array([-10.0, 10.0, 10.0]),
    new Float32Array([10.0, 10.0, 10.0]),
    new Float32Array([-10.0, -10.0, 10.0]),
    new Float32Array([10.0, -10.0, 10.0]),
];

const lightColors: Array<Float32Array> = [
    new Float32Array([300.0, 300.0, 300.0]),
    new Float32Array([300.0, 300.0, 300.0]),
    new Float32Array([300.0, 300.0, 300.0]),
    new Float32Array([300.0, 300.0, 300.0]),
];

const gl: WebGL2RenderingContext = getContext('#cvs');
gl.getExtension('EXT_color_buffer_float');
const { width: SCR_WIDTH, height: SCR_HEIGHT } = resizeCvs2Screen(gl);
gl.enable(gl.DEPTH_TEST);
gl.depthFunc(gl.LEQUAL)
gl.clearColor(0.1, 0.1, 0.1, 1.0);

const pbrShader: ShaderProgram = new ShaderProgram(gl, pbr_vs, pbr_fs, 'pbrShader');
const pbrInstancedShader: ShaderProgram = new ShaderProgram(gl, pbr_instanced_vs, pbr_fs, 'pbrShader');
const equirectangularToCubemapShader: ShaderProgram = new ShaderProgram(gl, cubemap_vs, equirectangular_to_cubemap_fs, 'equirectangularToCubemapShader');
const irradianceShader: ShaderProgram = new ShaderProgram(gl, cubemap_vs, irradiance_convolution_fs, 'irradianceShader');
const prefilterShader: ShaderProgram = new ShaderProgram(gl, cubemap_vs, prefilter_fs, 'prefilterShader');
const brdfShader: ShaderProgram = new ShaderProgram(gl, brdf_vs, brdf_fs, 'brdfShader');
const backgroundShader: ShaderProgram = new ShaderProgram(gl, background_vs, background_fs, 'backgroundShader');
const proceduralTexShader: ShaderProgram = new ShaderProgram(gl, quad_vs, calc_tex_fs, 'proceduralTexShader');

const proceduralTexFBO: WebGLFramebuffer = gl.createFramebuffer();
const proceduralTex: WebGLTexture = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, proceduralTex);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 512, 512, 0, gl.RGBA, gl.FLOAT, null);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
gl.generateMipmap(gl.TEXTURE_2D);
gl.bindFramebuffer(gl.FRAMEBUFFER, proceduralTexFBO);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, proceduralTex, 0);

proceduralTexShader.use();
proceduralTexShader.uniform2f('screenSize', SCR_WIDTH, SCR_HEIGHT);
drawQuad(gl);
gl.bindFramebuffer(gl.FRAMEBUFFER, null);

pbrShader.use();
pbrShader.uniform1i('irradianceMap', 0);
pbrShader.uniform1i('prefilterMap', 1);
pbrShader.uniform1i('brdfLUT', 2);
pbrShader.uniform3fv('albedo', new Float32Array([0.0, 0.0, 0.0]));
// pbrShader.uniform3fv('albedo', new Float32Array([1.0, 1.0, 1.0]));
pbrShader.uniform1f('ao', 1.0);

for (let i = 0, size = lightPositions.length; i < size; i++) {
    pbrShader.uniform3fv(`lightPositions[${i}]`, lightPositions[i]);
    pbrShader.uniform3fv(`lightColors[${i}]`, lightColors[i]);
}

pbrInstancedShader.use();
pbrInstancedShader.uniform1i('irradianceMap', 0);
pbrInstancedShader.uniform1i('prefilterMap', 1);
pbrInstancedShader.uniform1i('brdfLUT', 2);
pbrInstancedShader.uniform3fv('albedo', new Float32Array([0.5, 0.0, 0.0]));
pbrInstancedShader.uniform1f('ao', 1.0);

for (let i = 0, size = lightPositions.length; i < size; i++) {
    pbrInstancedShader.uniform3fv(`lightPositions[${i}]`, lightPositions[i]);
    pbrInstancedShader.uniform3fv(`lightColors[${i}]`, lightColors[i]);
}

backgroundShader.use();
backgroundShader.uniform1i('environmentMap', 0);

const captureFBO: WebGLFramebuffer = gl.createFramebuffer();
const captureRBO: WebGLRenderbuffer = gl.createRenderbuffer();

gl.bindFramebuffer(gl.FRAMEBUFFER, captureFBO);
gl.bindRenderbuffer(gl.RENDERBUFFER, captureRBO);
gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, 512, 512);
gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, captureRBO);

gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

const dragonMesh: ObjMesh = new ObjMesh(gl, './models/TheStanfordDragon.obj', []);
// const lujiazui: ObjMesh = new ObjMesh(gl, './models/shanghai_WEB.obj');
const lujiazui: ObjMesh = new ObjMesh(gl, './models/Tencent_BinHai.obj');

const myHDR = new HDRImage();
myHDR.src = './hdr/Mans_Outside_1080.hdr';
// myHDR.src = './hdr/Milkyway_small222.hdr';

myHDR.onload = function() {
    const hdrTexture: WebGLTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, hdrTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB16F, myHDR.width, myHDR.height, 0, gl.RGB, gl.FLOAT, myHDR.dataFloat);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // console.log(`gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT: ${gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT}`)
    // console.log(`gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS: ${gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS}`)
    // console.log(`gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT: ${gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT}`)
    // console.log(`gl.FRAMEBUFFER_INCOMPLETE_MULTISAMPLE: ${gl.FRAMEBUFFER_INCOMPLETE_MULTISAMPLE}`)

    const envCubemap: WebGLTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, envCubemap);
    for (let i = 0; i < 6; i++) {
        gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, 0, gl.RGBA16F, 512, 512, 0, gl.RGBA, gl.FLOAT, null);
    }

    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const captureProjection: mat4 = mat4.create();
    mat4.perspective(captureProjection, getRadian(90), 1.0, 0.1, 10.0);

    const pos_x: mat4 = mat4.create();
    mat4.lookAt(pos_x, [0, 0, 0], [1, 0, 0], [0, -1, 0]);
    const neg_x: mat4 = mat4.create();
    mat4.lookAt(neg_x, [0, 0, 0], [-1, 0, 0], [0, -1, 0]);
    const pos_y: mat4 = mat4.create();
    mat4.lookAt(pos_y, [0, 0, 0], [0, 1, 0], [0, 0, 1]);
    const neg_y: mat4 = mat4.create();
    mat4.lookAt(neg_y, [0, 0, 0], [0, -1, 0], [0, 0, -1]);
    const pos_z: mat4 = mat4.create();
    mat4.lookAt(pos_z, [0, 0, 0], [0, 0, 1], [0, -1, 0]);
    const neg_z: mat4 = mat4.create();
    mat4.lookAt(neg_z, [0, 0, 0], [0, 0, -1], [0, -1, 0]);
    const captureViews: Array<mat4> = [
        pos_x,
        neg_x,
        pos_y,
        neg_y,
        pos_z,
        neg_z
    ];

    equirectangularToCubemapShader.use();
    equirectangularToCubemapShader.uniform1i('equirectangularMap', 0);
    equirectangularToCubemapShader.uniformMatrix4fv('projection', captureProjection);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, hdrTexture);

    gl.viewport(0, 0, 512, 512);
    gl.bindFramebuffer(gl.FRAMEBUFFER, captureFBO);
    for (let i = 0; i < 6; i++) {
        equirectangularToCubemapShader.uniformMatrix4fv('view', captureViews[i]);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, envCubemap, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        drawCube(gl);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gl.bindTexture(gl.TEXTURE_CUBE_MAP, envCubemap);
    gl.generateMipmap(gl.TEXTURE_CUBE_MAP);

    const irradianceMap: WebGLTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, irradianceMap);
    for (let i = 0; i < 6; i++) {
        gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, 0, gl.RGBA16F, 32, 32, 0, gl.RGBA, gl.FLOAT, null);
    }
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    gl.bindFramebuffer(gl.FRAMEBUFFER, captureFBO);
    gl.bindRenderbuffer(gl.RENDERBUFFER, captureRBO);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, 32, 32);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, captureRBO);

    irradianceShader.use();
    irradianceShader.uniform1i('environmentMap', 0);
    irradianceShader.uniformMatrix4fv('projection', captureProjection);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, envCubemap);

    gl.viewport(0, 0, 32, 32);
    gl.bindFramebuffer(gl.FRAMEBUFFER, captureFBO);
    for (let i = 0; i < 6; i++) {
        irradianceShader.uniformMatrix4fv('view', captureViews[i]);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, irradianceMap, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        drawCube(gl);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const prefilterMap: WebGLTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, prefilterMap);
    for (let i = 0; i < 6; i++) {
        gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, 0, gl.RGBA16F, 128, 128, 0, gl.RGBA, gl.FLOAT, null);
    }
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_CUBE_MAP);

    prefilterShader.use();
    prefilterShader.uniform1i('environmentMap', 0);
    prefilterShader.uniformMatrix4fv('projection', captureProjection);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, envCubemap);

    gl.bindFramebuffer(gl.FRAMEBUFFER, captureFBO);
    const maxMipLevels: number = 5;
    for (let mip: number = 0; mip < maxMipLevels; mip++) {
        const mipWidth: number = 128 * Math.pow(0.5, mip);
        const mipHeight: number = 128 * Math.pow(0.5, mip);
        gl.bindRenderbuffer(gl.RENDERBUFFER, captureRBO);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, mipWidth, mipHeight);
        gl.viewport(0, 0, mipWidth, mipHeight);

        const roughness: number = mip / (maxMipLevels - 1);
        prefilterShader.uniform1f('roughness', roughness);
        for (let i = 0; i < 6; i++) {
            prefilterShader.uniformMatrix4fv('view', captureViews[i]);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, prefilterMap, mip);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            drawCube(gl);
        }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    
    const brdfLUTTexture: WebGLTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, brdfLUTTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, 512, 512, 0, gl.RG, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    gl.bindFramebuffer(gl.FRAMEBUFFER, captureFBO);
    gl.bindRenderbuffer(gl.RENDERBUFFER, captureRBO);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, 512, 512);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, brdfLUTTexture, 0);

    gl.viewport(0, 0, 512, 512);
    brdfShader.use();
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    drawQuadWithTex(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gl.viewport(0, 0, SCR_WIDTH, SCR_HEIGHT);
    gl.clearColor(0.2, 0.3, 0.3, 1.0);
    const camera: OrbitCamera = new OrbitCamera(gl, 45, 0, 0, SCR_WIDTH / SCR_HEIGHT, 0.1, 1000.0);

    function drawCB(): void {
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        const view: mat4 = camera.getViewMatrix();
        const perspective: mat4 = camera.getPerspectiveMatrix();
        // const camPos: vec3 = camera.getPosition();
        const camPos: vec3 = camera.position;

        pbrShader.use();
        pbrShader.uniformMatrix4fv('view', view);
        pbrShader.uniformMatrix4fv('projection', perspective);
        pbrShader.uniform3fv('camPos', camPos);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, irradianceMap);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, prefilterMap);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, brdfLUTTexture);

        const model: mat4 = mat4.create();
        // mat4.translate(model, model, [1.0, 1.0, 1.0]);
        mat4.scale(model, model, [ctrl.mainBuildingScale, ctrl.mainBuildingScale, ctrl.mainBuildingScale])
        pbrShader.uniform1f('metallic', ctrl.mainBuildingMetallic);
        pbrShader.uniform1f('roughness', ctrl.roughness);
        pbrShader.uniformMatrix4fv('model', model);
        // drawCubeSmooth(gl);
        // drawCube(gl);
        renderSphere(gl);
        // mat4.translate(model, model, [5, 0, 0]);
        // pbrShader.uniformMatrix4fv('model', model);
        // dragonMesh.draw();

        // lujiazui.draw();

        // pbrInstancedShader.use();
        // pbrInstancedShader.uniformMatrix4fv('view', view);
        // pbrInstancedShader.uniformMatrix4fv('projection', perspective);
        // pbrInstancedShader.uniform3fv('camPos', camPos);
        // pbrInstancedShader.uniform1f('metallic', metallic);
        // pbrInstancedShader.uniform1f('roughness', roughness);
        // drawFakeBuildings();

        backgroundShader.use();
        backgroundShader.uniformMatrix4fv('projection', perspective);
        backgroundShader.uniformMatrix4fv('view', view);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, envCubemap);

        drawCube(gl);
    }

    const looper = new RenderLooper(drawCB).start();
}

const gridCnts: number = 60;
const gridSize: number = 1;
const buildingPoses: Array<mat4> = [];
function getRandom(start: number, end: number): number {
    return start + (end - start) * Math.random();
}

function generateBuildingPos(gridSize: number, gridCnts: number) {
    const halfWidth: number = gridSize * gridCnts * 0.5;
    // 列主序！！！
    const w2Checkerboard: mat4 = mat4.fromValues(
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        -halfWidth, 0, -halfWidth, 1
    );
    
    const discard: number = Math.floor(gridCnts * 0.5);
    
    for (let row = 0; row < gridCnts; row++) {
        const riverPart: Array<number> = river[row + 1] || [];
        for (let column = 0; column < gridCnts; column++) {
            if (riverPart.length > 0 && column >= riverPart[0] - 1 && column <= riverPart[1] - 1) continue;

            // if (row >= discard -2 && row <= discard && column >= discard - 2 && column <= discard) continue;
            const localMx: mat4 = mat4.create();
            mat4.translate(localMx, localMx, [column * gridSize + 0.5 * gridSize, 0.0, row * gridSize + 0.5 * gridSize]);
            // mat4.rotateX(localMx, localMx, getRadian(-90));
            // mat4.rotateY(localMx, localMx, getRadian(90 * Math.random()));
            mat4.scale(localMx, localMx, [0.5 * gridSize, 0.5 * gridSize, 0.5 * gridSize]);
            mat4.scale(localMx, localMx, [getRandom(0.3, 0.5), getRandom(0.5, 1.5), getRandom(0.4, 0.6)])
            const finalModelMx: mat4 = mat4.create();
            mat4.multiply(finalModelMx, w2Checkerboard, localMx);
            buildingPoses.push(finalModelMx);
        }
    }    
}

generateBuildingPos(gridSize, gridCnts);

let fakeBuildingsVAO: WebGLVertexArrayObject;
function drawFakeBuildings(): void {
    if (!fakeBuildingsVAO) {
        fakeBuildingsVAO = gl.createVertexArray();
        gl.bindVertexArray(fakeBuildingsVAO);
        const vertexData: Float32Array = new Float32Array([
            // back face
            -1.0, 0.0, -1.0,  0.0,  0.0, -1.0, 0.0, 0.0, // bottom-left
             1.0,  2.0, -1.0,  0.0,  0.0, -1.0, 1.0, 1.0, // top-right
             1.0, 0.0, -1.0,  0.0,  0.0, -1.0, 1.0, 0.0, // bottom-right         
             1.0,  2.0, -1.0,  0.0,  0.0, -1.0, 1.0, 1.0, // top-right
            -1.0, 0.0, -1.0,  0.0,  0.0, -1.0, 0.0, 0.0, // bottom-left
            -1.0,  2.0, -1.0,  0.0,  0.0, -1.0, 0.0, 1.0, // top-left
            // front face
            -1.0, 0.0,  1.0,  0.0,  0.0,  1.0, 0.0, 0.0, // bottom-left
             1.0, 0.0,  1.0,  0.0,  0.0,  1.0, 1.0, 0.0, // bottom-right
             1.0,  2.0,  1.0,  0.0,  0.0,  1.0, 1.0, 1.0, // top-right
             1.0,  2.0,  1.0,  0.0,  0.0,  1.0, 1.0, 1.0, // top-right
            -1.0,  2.0,  1.0,  0.0,  0.0,  1.0, 0.0, 1.0, // top-left
            -1.0,  0.0,  1.0,  0.0,  0.0,  1.0, 0.0, 0.0, // bottom-left
            // left face
            -1.0,  2.0,  1.0, -1.0,  0.0,  0.0, 1.0, 0.0, // top-right
            -1.0,  2.0, -1.0, -1.0,  0.0,  0.0, 1.0, 1.0, // top-left
            -1.0,  0.0, -1.0, -1.0,  0.0,  0.0, 0.0, 1.0, // bottom-left
            -1.0,  0.0, -1.0, -1.0,  0.0,  0.0, 0.0, 1.0, // bottom-left
            -1.0, 0.0,  1.0, -1.0,  0.0,  0.0, 0.0, 0.0, // bottom-right
            -1.0,  2.0,  1.0, -1.0,  0.0,  0.0, 1.0, 0.0, // top-right
            // right face
             1.0,  2.0,  1.0,  1.0,  0.0,  0.0, 1.0, 0.0, // top-left
             1.0,  0.0, -1.0,  1.0,  0.0,  0.0, 0.0, 1.0, // bottom-right
             1.0,  2.0, -1.0,  1.0,  0.0,  0.0, 1.0, 1.0, // top-right         
             1.0,  0.0, -1.0,  1.0,  0.0,  0.0, 0.0, 1.0, // bottom-right
             1.0,  2.0,  1.0,  1.0,  0.0,  0.0, 1.0, 0.0, // top-left
             1.0,  0.0,  1.0,  1.0,  0.0,  0.0, 0.0, 0.0, // bottom-left     
            // bottom face
            -1.0,  0.0, -1.0,  0.0, -1.0,  0.0, 0.0, 1.0, // top-right
             1.0,  0.0, -1.0,  0.0, -1.0,  0.0, 1.0, 1.0, // top-left
             1.0,  0.0,  1.0,  0.0, -1.0,  0.0, 1.0, 0.0, // bottom-left
             1.0,  0.0,  1.0,  0.0, -1.0,  0.0, 1.0, 0.0, // bottom-left
            -1.0,  0.0,  1.0,  0.0, -1.0,  0.0, 0.0, 0.0, // bottom-right
            -1.0,  0.0, -1.0,  0.0, -1.0,  0.0, 0.0, 1.0, // top-right
            // top face
            -1.0,  2.0, -1.0,  0.0,  1.0,  0.0, 0.0, 1.0, // top-left
             1.0,  2.0,  1.0,  0.0,  1.0,  0.0, 1.0, 0.0, // bottom-right
             1.0,  2.0, -1.0,  0.0,  1.0,  0.0, 1.0, 1.0, // top-right     
             1.0,  2.0,  1.0,  0.0,  1.0,  0.0, 1.0, 0.0, // bottom-right
            -1.0,  2.0, -1.0,  0.0,  1.0,  0.0, 0.0, 1.0, // top-left
            -1.0,  2.0,  1.0,  0.0,  1.0,  0.0, 0.0, 0.0  // bottom-left  
        ]);
        const vertexVBO: WebGLBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vertexVBO);
        gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 8 * Float32Array.BYTES_PER_ELEMENT, 0);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 8 * Float32Array.BYTES_PER_ELEMENT, 3 * Float32Array.BYTES_PER_ELEMENT);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 8 * Float32Array.BYTES_PER_ELEMENT, 6 * Float32Array.BYTES_PER_ELEMENT);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);

        // 使用实例化数组
        const modelArr: Array<number> = buildingPoses.reduce((acc: Array<number>, current: mat4) => {
            for (let i = 0, size = current.length; i < size; i++) {
                acc.push(current[i]);
            }
            return acc;
        }, []);

        const modelVBO: WebGLBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, modelVBO);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(modelArr), gl.STATIC_DRAW);

        gl.enableVertexAttribArray(3);
        gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 16 * Float32Array.BYTES_PER_ELEMENT, 0);

        gl.enableVertexAttribArray(4);
        gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 16 * Float32Array.BYTES_PER_ELEMENT, 4 * Float32Array.BYTES_PER_ELEMENT);

        gl.enableVertexAttribArray(5);
        gl.vertexAttribPointer(5, 4, gl.FLOAT, false, 16 * Float32Array.BYTES_PER_ELEMENT, 8 * Float32Array.BYTES_PER_ELEMENT);

        gl.enableVertexAttribArray(6);
        gl.vertexAttribPointer(6, 4, gl.FLOAT, false, 16 * Float32Array.BYTES_PER_ELEMENT, 12 * Float32Array.BYTES_PER_ELEMENT);
        
        gl.vertexAttribDivisor(3, 1);
        gl.vertexAttribDivisor(4, 1);
        gl.vertexAttribDivisor(5, 1);
        gl.vertexAttribDivisor(6, 1);

        gl.bindVertexArray(null);

    }
    gl.bindVertexArray(fakeBuildingsVAO);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, buildingPoses.length);
    gl.bindVertexArray(null);
}