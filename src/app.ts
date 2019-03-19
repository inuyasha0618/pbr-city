import { mat4, vec3 } from 'gl-matrix'
import * as dat from 'dat.gui';
import RenderLooper from 'render-looper';
import { ShaderProgram, drawCube, drawCubeSmooth, OrbitCamera, drawQuad, drawQuadWithTex, renderSphere, ObjMesh } from './gl-helpers/index';
import { getContext, resizeCvs2Screen, getRadian, color2fract } from './utils/index';
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
import pbr_instanced_fs from './shaders/pbr_instanced_fs';
import prefilter_fs from './shaders/prefilter_fs';
import quad_vs from './shaders/quad_vs';
import quad_fs from './shaders/quad_fs';
import calc_tex_vs from './shaders/calc_tex_vs';
import calc_tex_fs from './shaders/calc_tex_fs';
import river from './river2';

class MaterialCtrl {
    roughness: number = 0.01;
    scale: number = 1.0;
    metallic: number = 0.9;

    constructor(roughness: number = 0.01, metallic: number = 0.9) {
        this.roughness = roughness;
        this.metallic = metallic;
    }
}
const mainBuildingCtrl = new MaterialCtrl();
const surroundingCtrl = new MaterialCtrl();
const groundCtrl = new MaterialCtrl(0.83, 0.8);

const totalCtrl = {
    fogBegin: 33.0,
    fogEnd: 112.0
}

const palette = {
    buildingColor: [ 44, 202, 223 ], // RGB array
    groundColor: [ 15, 14, 14 ], // RGB array
};

window.onload = function() {
    const gui = new dat.GUI();

    const main = gui.addFolder('main building');
    main.add(mainBuildingCtrl, 'roughness', 0.0, 1.0);
    main.add(mainBuildingCtrl, 'scale', 1.0, 15.0);
    main.add(mainBuildingCtrl, 'metallic', 0.0, 1.0);

    const surrounding = gui.addFolder('surrounding buildings');
    surrounding.add(surroundingCtrl, 'roughness', 0.0, 1.0);
    surrounding.add(surroundingCtrl, 'metallic', 0.0, 1.0);

    const ground = gui.addFolder('ground');
    ground.add(groundCtrl, 'roughness', 0.0, 1.0);
    ground.add(groundCtrl, 'metallic', 0.0, 1.0);

    gui.add(totalCtrl, 'fogBegin', 10.0, 100.0);
    gui.add(totalCtrl, 'fogEnd', 70.0, 120.0);


    gui.addColor(palette, 'buildingColor');
    gui.addColor(palette, 'groundColor');
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

const nrRows: number = 7;
const nrColumns: number = 7;
const spacing: number = 2.5;

const gl: WebGL2RenderingContext = getContext('#cvs');
gl.getExtension('EXT_color_buffer_float');
const { width: SCR_WIDTH, height: SCR_HEIGHT } = resizeCvs2Screen(gl);
gl.enable(gl.DEPTH_TEST);
gl.depthFunc(gl.LEQUAL)
gl.clearColor(0.1, 0.1, 0.1, 1.0);

const pbrShader: ShaderProgram = new ShaderProgram(gl, pbr_vs, pbr_fs, 'pbrShader');
// const pbrInstancedShader: ShaderProgram = new ShaderProgram(gl, pbr_instanced_vs, pbr_instanced_fs, 'pbrInstancedShader');
const pbrInstancedShader: ShaderProgram = new ShaderProgram(gl, pbr_instanced_vs, pbr_fs, 'pbrInstancedShader');
const equirectangularToCubemapShader: ShaderProgram = new ShaderProgram(gl, cubemap_vs, equirectangular_to_cubemap_fs, 'equirectangularToCubemapShader');
const irradianceShader: ShaderProgram = new ShaderProgram(gl, cubemap_vs, irradiance_convolution_fs, 'irradianceShader');
const prefilterShader: ShaderProgram = new ShaderProgram(gl, cubemap_vs, prefilter_fs, 'prefilterShader');
const brdfShader: ShaderProgram = new ShaderProgram(gl, brdf_vs, brdf_fs, 'brdfShader');
const backgroundShader: ShaderProgram = new ShaderProgram(gl, background_vs, background_fs, 'backgroundShader');
const proceduralTexShader: ShaderProgram = new ShaderProgram(gl, calc_tex_vs, calc_tex_fs, 'proceduralTexShader');
const testQuadShader: ShaderProgram = new ShaderProgram(gl, quad_vs, quad_fs, 'testQuadShader');

// const proceduralTexFBO: WebGLFramebuffer = gl.createFramebuffer();
// const proceduralTex: WebGLTexture = gl.createTexture();
// gl.bindTexture(gl.TEXTURE_2D, proceduralTex);
// gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 512, 512, 0, gl.RGBA, gl.FLOAT, null);
// gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
// gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
// gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
// // gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
// gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
// // gl.generateMipmap(gl.TEXTURE_2D);
// gl.bindFramebuffer(gl.FRAMEBUFFER, proceduralTexFBO);
// gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, proceduralTex, 0);
// gl.viewport(0, 0, 512, 512);
// gl.clear(gl.COLOR_BUFFER_BIT);
// proceduralTexShader.use();
// drawQuadWithTex(gl);
// gl.bindFramebuffer(gl.FRAMEBUFFER, null);
// gl.viewport(0, 0, SCR_WIDTH, SCR_HEIGHT);
// gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
// testQuadShader.use();
// testQuadShader.uniform2f('screenSize', SCR_WIDTH, SCR_HEIGHT);
// testQuadShader.uniform1i('tex', 0);
// gl.activeTexture(gl.TEXTURE0);
// gl.bindTexture(gl.TEXTURE_2D, proceduralTex);
// drawQuad(gl);
// throw 'testing';


pbrShader.use();
pbrShader.uniform1i('irradianceMap', 0);
pbrShader.uniform1i('prefilterMap', 1);
pbrShader.uniform1i('brdfLUT', 2);
pbrShader.uniform1f('ao', 1.0);

for (let i = 0, size = lightPositions.length; i < size; i++) {
    pbrShader.uniform3fv(`lightPositions[${i}]`, lightPositions[i]);
    pbrShader.uniform3fv(`lightColors[${i}]`, lightColors[i]);
}

pbrInstancedShader.use();
pbrInstancedShader.uniform1i('irradianceMap', 0);
pbrInstancedShader.uniform1i('prefilterMap', 1);
pbrInstancedShader.uniform1i('brdfLUT', 2);
pbrInstancedShader.uniform1i('tex', 3);
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

// const dragonMesh: ObjMesh = new ObjMesh(gl, './models/TheStanfordDragon.obj', []);
const lujiazui: ObjMesh = new ObjMesh(gl, './models/shanghai_WEB.obj');
// const lujiazui: ObjMesh = new ObjMesh(gl, './models/Tencent_BinHai.obj');

const myHDR = new HDRImage();
// myHDR.src = './hdr/Mans_Outside_1080.hdr';
// myHDR.src = './hdr/5TH_AVENUE.hdr';
myHDR.src = './hdr/Milkyway_small222.hdr';
// myHDR.src = './hdr/newport_loft.hdr';

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

    // gl.viewport(0, 0, SCR_WIDTH, SCR_HEIGHT);
    // gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // testQuadShader.use();
    // testQuadShader.uniform2f('screenSize', SCR_WIDTH, SCR_HEIGHT);
    // testQuadShader.uniform1i('tex', 0);
    // gl.activeTexture(gl.TEXTURE0);
    // gl.bindTexture(gl.TEXTURE_2D, brdfLUTTexture);
    // drawQuad(gl);
    // throw 'testing'; 

    gl.viewport(0, 0, SCR_WIDTH, SCR_HEIGHT);
    gl.clearColor(0.1, 0.1, 0.1, 1.0);
    const camera: OrbitCamera = new OrbitCamera(gl, 23, 264, -22, SCR_WIDTH / SCR_HEIGHT, 1.0, 1000.0);
    window.camera = camera;
    function drawCB(): void {
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        camera.addYaw(0.2);
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
        mat4.scale(model, model, [mainBuildingCtrl.scale, mainBuildingCtrl.scale, mainBuildingCtrl.scale])
        pbrShader.uniform1f('metallic', mainBuildingCtrl.metallic);
        pbrShader.uniform1f('roughness', mainBuildingCtrl.roughness);
        pbrShader.uniformMatrix4fv('model', model);
        pbrShader.uniform3fv('albedo', color2fract(palette.buildingColor));
        pbrShader.uniform2f('uFogDist', totalCtrl.fogBegin, totalCtrl.fogEnd);
        pbrShader.uniform3fv('uFogColor', new Float32Array([0.0, 0.0, 0.0]));
        // drawCubeSmooth(gl);
        // drawCube(gl);
        // renderSphere(gl);
        // mat4.translate(model, model, [5, 0, 0]);
        // pbrShader.uniformMatrix4fv('model', model);
        // dragonMesh.draw();


        // 测试渲染的正确性
        // for (let row: number = 0; row < nrRows; ++row)
        // {
        //     pbrShader.uniform1f("metallic", row / nrRows);
        //     for (let col: number = 0; col < nrColumns; ++col)
        //     {
        //         // we clamp the roughness to 0.025 - 1.0 as perfectly smooth surfaces (roughness of 0.0) tend to look a bit off
        //         // on direct lighting.
        //         pbrShader.uniform1f("roughness", clamp(col / nrColumns, 0.05, 1.0));

        //         const model: mat4 = mat4.create();
        //         mat4.translate(model, model, [(col - (nrColumns / 2)) * spacing, (row - (nrRows / 2)) * spacing, -2.0])

        //         // model = glm::translate(model, glm::vec3(
        //         //     (float)(col - (nrColumns / 2)) * spacing,
        //         //     (float)(row - (nrRows / 2)) * spacing,
        //         //     -2.0f
        //         // ));
        //         pbrShader.uniformMatrix4fv("model", model);
        //         renderSphere(gl);
        //     }
        // }



        lujiazui.draw();

        pbrInstancedShader.use();
        pbrInstancedShader.uniformMatrix4fv('view', view);
        pbrInstancedShader.uniformMatrix4fv('projection', perspective);
        pbrInstancedShader.uniform3fv('camPos', camPos);
        pbrInstancedShader.uniform1f('metallic', surroundingCtrl.metallic);
        pbrInstancedShader.uniform1f('roughness', surroundingCtrl.roughness);
        pbrInstancedShader.uniform3fv('albedo', color2fract(palette.buildingColor));
        pbrInstancedShader.uniform2f('uFogDist', totalCtrl.fogBegin, totalCtrl.fogEnd);
        pbrInstancedShader.uniform3fv('uFogColor', new Float32Array([0.2, 0.2, 0.2]));

        drawFakeBuildings();

        pbrShader.use();

        // pbrShader.uniform2f('uFogDist', 100000, 1000000);
        const groundModel: mat4 = mat4.create();
        mat4.rotateX(groundModel, groundModel, getRadian(-90));
        mat4.scale(groundModel, groundModel, [1000.0, 1000.0, 1000.0]);
        pbrShader.uniformMatrix4fv('model', groundModel);
        pbrShader.uniform1f('roughness', groundCtrl.roughness);
        pbrShader.uniform1f('metallic', groundCtrl.metallic);
        pbrShader.uniform3fv('albedo', color2fract(palette.groundColor));

        drawQuad(gl);

        // backgroundShader.use();
        // backgroundShader.uniformMatrix4fv('projection', perspective);
        // backgroundShader.uniformMatrix4fv('view', view);
        // gl.activeTexture(gl.TEXTURE0);
        // // gl.bindTexture(gl.TEXTURE_CUBE_MAP, envCubemap);
        // // gl.bindTexture(gl.TEXTURE_CUBE_MAP, irradianceMap);
        // gl.bindTexture(gl.TEXTURE_CUBE_MAP, prefilterMap);

        // drawCube(gl);
    }

    const looper = new RenderLooper(drawCB).start();
}

const gridCnts: number = 60;
const paddingCnts: number = 100;
const gridSize: number = 1.5;
const buildingPoses: Array<mat4> = [];
function getRandom(start: number, end: number): number {
    return start + (end - start) * Math.random();
}

const beginDist: number = 5;
const endDist: number = 50;

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
    const halfCnts: number = gridCnts * 0.5;
    for (let row = -paddingCnts; row < gridCnts + paddingCnts; row++) {
        const riverPart: Array<number> = river[row + 1] || [];
        for (let column = -paddingCnts; column < gridCnts + paddingCnts; column++) {
            const dist2center: number = Math.sqrt((row - halfCnts) * (row - halfCnts) + (column - halfCnts) * (column - halfCnts));
            const density: number = calcuDensity(dist2center, beginDist, endDist);
            if (Math.random() > density) continue;
            if (riverPart.length > 0 && column >= riverPart[0] - 1 && column <= riverPart[1] - 1) continue;

            // if (row >= discard -2 && row <= discard && column >= discard - 2 && column <= discard) continue;
            const localMx: mat4 = mat4.create();
            mat4.translate(localMx, localMx, [column * gridSize + 0.5 * gridSize, 0.0, row * gridSize + 0.5 * gridSize]);
            // mat4.rotateX(localMx, localMx, getRadian(-90));
            mat4.rotateY(localMx, localMx, getRadian(60 * Math.random()));
            mat4.scale(localMx, localMx, [0.5 * gridSize, 0.5 * gridSize, 0.5 * gridSize]);
            const scaleX: number = Math.random()*Math.random()*Math.random()*Math.random() * 0.5 + 0.5;
            const scaleY: number = (Math.random() * Math.random()) * 8 + 0.5;
            const scaleZ = getRandom(0.4, 1.0);
            // mat4.scale(localMx, localMx, [getRandom(0.3, 0.5), getRandom(0.5, 1.5), getRandom(0.4, 0.6)]);
            mat4.scale(localMx, localMx, [scaleX, scaleY, scaleZ]);
            const finalModelMx: mat4 = mat4.create();
            mat4.multiply(finalModelMx, w2Checkerboard, localMx);
            buildingPoses.push(finalModelMx);
        }
    }    
}

function clamp(x: number, min: number, max: number): number {
    if (x < min) {
        return min;
    } else if (x > max) {
        return max;
    } else {
        return x;
    }
}

function calcuDensity(dist: number, start: number, end: number): number  {
    return clamp((end - dist) / (end - start), 0.05, 0.15);
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
            -1.0,  2.0,  1.0, -1.0,  0.0,  0.0, 1.0, 1.0, // top-right
            -1.0,  2.0, -1.0, -1.0,  0.0,  0.0, 0.0, 1.0, // top-left
            -1.0,  0.0, -1.0, -1.0,  0.0,  0.0, 0.0, 0.0, // bottom-left
            -1.0,  0.0, -1.0, -1.0,  0.0,  0.0, 0.0, 0.0, // bottom-left
            -1.0, 0.0,  1.0, -1.0,  0.0,  0.0, 1.0, 0.0, // bottom-right
            -1.0,  2.0,  1.0, -1.0,  0.0,  0.0, 1.0, 1.0, // top-right
            // right face
             1.0,  2.0,  1.0,  1.0,  0.0,  0.0, 0.0, 1.0, // top-left
             1.0,  0.0, -1.0,  1.0,  0.0,  0.0, 1.0, 0.0, // bottom-right
             1.0,  2.0, -1.0,  1.0,  0.0,  0.0, 1.0, 1.0, // top-right         
             1.0,  0.0, -1.0,  1.0,  0.0,  0.0, 1.0, 0.0, // bottom-right
             1.0,  2.0,  1.0,  1.0,  0.0,  0.0, 0.0, 1.0, // top-left
             1.0,  0.0,  1.0,  1.0,  0.0,  0.0, 0.0, 0.0, // bottom-left     
            // bottom face
            -1.0,  0.0, -1.0,  0.0, -1.0,  0.0, 1.0, 1.0, // top-right
             1.0,  0.0, -1.0,  0.0, -1.0,  0.0, 1.0, 1.0, // top-left
             1.0,  0.0,  1.0,  0.0, -1.0,  0.0, 1.0, 1.0, // bottom-left
             1.0,  0.0,  1.0,  0.0, -1.0,  0.0, 1.0, 1.0, // bottom-left
            -1.0,  0.0,  1.0,  0.0, -1.0,  0.0, 1.0, 1.0, // bottom-right
            -1.0,  0.0, -1.0,  0.0, -1.0,  0.0, 1.0, 1.0, // top-right
            // top face
            -1.0,  2.0, -1.0,  0.0,  1.0,  0.0, 1.0, 1.0, // top-left
             1.0,  2.0,  1.0,  0.0,  1.0,  0.0, 1.0, 1.0, // bottom-right
             1.0,  2.0, -1.0,  0.0,  1.0,  0.0, 1.0, 1.0, // top-right     
             1.0,  2.0,  1.0,  0.0,  1.0,  0.0, 1.0, 1.0, // bottom-right
            -1.0,  2.0, -1.0,  0.0,  1.0,  0.0, 1.0, 1.0, // top-left
            -1.0,  2.0,  1.0,  0.0,  1.0,  0.0, 1.0, 1.0  // bottom-left  
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