import { composite } from './compositor';
import type { BlendMode, Layer, PaintDocument } from '../types';

const SUPPORTED_BLEND_MODES = new Set<BlendMode>(['normal', 'multiply', 'screen']);

const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
out vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_backdrop;
uniform sampler2D u_source;
uniform float u_opacity;
uniform int u_blendMode;

in vec2 v_uv;
out vec4 outColor;

vec3 blendColor(vec3 b, vec3 s) {
  if (u_blendMode == 1) return b * s;
  if (u_blendMode == 2) return b + s - b * s;
  return s;
}

void main() {
  vec4 dst = texture(u_backdrop, v_uv);
  vec4 src = texture(u_source, v_uv);
  float sa = src.a * u_opacity;
  float da = dst.a;

  if (sa <= 0.0) {
    outColor = dst;
    return;
  }

  vec3 blended = da > 0.0 ? blendColor(dst.rgb, src.rgb) : src.rgb;
  vec3 mixed = mix(src.rgb, blended, da);
  float oa = sa + da * (1.0 - sa);

  if (oa <= 0.0) {
    outColor = vec4(0.0);
    return;
  }

  vec3 rgb = (mixed * sa + dst.rgb * da * (1.0 - sa)) / oa;
  outColor = vec4(rgb, oa);
}
`;

interface GpuCompositor {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  framebuffer: WebGLFramebuffer;
  textures: WebGLTexture[];
  positionBuffer: WebGLBuffer;
  uniforms: {
    backdrop: WebGLUniformLocation | null;
    source: WebGLUniformLocation | null;
    opacity: WebGLUniformLocation | null;
    blendMode: WebGLUniformLocation | null;
  };
}

export function isWebGLAvailable(): boolean {
  try {
    if (typeof document === 'undefined') return false;
    if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) return false;

    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      stencil: false,
    });
    return !!gl;
  } catch {
    return false;
  }
}

export function compositeAuto(doc: PaintDocument): ImageData {
  try {
    if (!canUseGpuPath(doc) || !isWebGLAvailable()) return composite(doc);
    return compositeGpu(doc);
  } catch {
    return composite(doc);
  }
}

function canUseGpuPath(doc: PaintDocument): boolean {
  if (doc.width <= 0 || doc.height <= 0) return false;

  for (const layer of doc.layers) {
    if (layer.kind !== 'raster') return false;
    if (layer.clipping || layer.mask) return false;
    if (!SUPPORTED_BLEND_MODES.has(layer.blendMode)) return false;
  }

  return true;
}

function compositeGpu(doc: PaintDocument): ImageData {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = doc.width;
    canvas.height = doc.height;

    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      stencil: false,
    });
    if (!gl) return composite(doc);

    const gpu = createGpuCompositor(gl);
    const empty = new Uint8Array(doc.width * doc.height * 4);
    gl.viewport(0, 0, doc.width, doc.height);
    uploadTexture(gl, gpu.textures[0], doc.width, doc.height, empty);
    uploadTexture(gl, gpu.textures[1], doc.width, doc.height, empty);

    let backdropIndex = 0;
    let targetIndex = 1;

    for (const layer of doc.layers) {
      if (!layer.visible || layer.opacity <= 0 || !layer.pixels) continue;

      uploadTexture(gl, gpu.textures[2], doc.width, doc.height, layer.pixels);
      renderLayer(gpu, doc.width, doc.height, backdropIndex, 2, targetIndex, layer);
      [backdropIndex, targetIndex] = [targetIndex, backdropIndex];
    }

    return readImageData(gl, doc.width, doc.height, gpu.textures[backdropIndex], gpu.framebuffer);
  } catch {
    return composite(doc);
  }
}

function createGpuCompositor(gl: WebGL2RenderingContext): GpuCompositor {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = linkProgram(gl, vertexShader, fragmentShader);
  const framebuffer = required(gl.createFramebuffer());
  const positionBuffer = required(gl.createBuffer());
  const textures = [
    required(gl.createTexture()),
    required(gl.createTexture()),
    required(gl.createTexture()),
  ];

  gl.useProgram(program);
  const position = gl.getAttribLocation(program, 'a_position');
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const uniforms = {
    backdrop: gl.getUniformLocation(program, 'u_backdrop'),
    source: gl.getUniformLocation(program, 'u_source'),
    opacity: gl.getUniformLocation(program, 'u_opacity'),
    blendMode: gl.getUniformLocation(program, 'u_blendMode'),
  };

  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.disable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);

  return { gl, program, framebuffer, textures, positionBuffer, uniforms };
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = required(gl.createShader(type));
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? 'WebGL shader compile failed');
  }
  return shader;
}

function linkProgram(
  gl: WebGL2RenderingContext,
  vertexShader: WebGLShader,
  fragmentShader: WebGLShader,
): WebGLProgram {
  const program = required(gl.createProgram());
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? 'WebGL program link failed');
  }
  return program;
}

function uploadTexture(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture,
  width: number,
  height: number,
  pixels: ArrayBufferView,
): void {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
}

function renderLayer(
  gpu: GpuCompositor,
  width: number,
  height: number,
  backdropIndex: number,
  sourceIndex: number,
  targetIndex: number,
  layer: Layer,
): void {
  const { gl, framebuffer, program, textures, uniforms } = gpu;
  gl.useProgram(program);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    textures[targetIndex],
    0,
  );
  ensureFramebuffer(gl);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, textures[backdropIndex]);
  gl.uniform1i(uniforms.backdrop, 0);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, textures[sourceIndex]);
  gl.uniform1i(uniforms.source, 1);
  gl.uniform1f(uniforms.opacity, layer.opacity);
  gl.uniform1i(uniforms.blendMode, blendModeId(layer.blendMode));

  gl.viewport(0, 0, width, height);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function readImageData(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  texture: WebGLTexture,
  framebuffer: WebGLFramebuffer,
): ImageData {
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  ensureFramebuffer(gl);

  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return new ImageData(new Uint8ClampedArray(pixels), width, height);
}

function blendModeId(mode: BlendMode): number {
  if (mode === 'multiply') return 1;
  if (mode === 'screen') return 2;
  return 0;
}

function ensureFramebuffer(gl: WebGL2RenderingContext): void {
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('WebGL framebuffer incomplete');
  }
}

function required<T>(value: T | null): T {
  if (value === null) throw new Error('WebGL resource allocation failed');
  return value;
}
