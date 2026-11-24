import type { Adjustments } from '../model/types';

/** Anything WebGL can upload as a texture. */
export type FrameSource = HTMLVideoElement | HTMLCanvasElement | OffscreenCanvas | ImageBitmap | VideoFrame;

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
uniform vec2 uScale;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos * uScale, 0.0, 1.0);
}`;

// Same order as the macOS version: exposure (CIExposureAdjust) then
// brightness / contrast / saturation (CIColorControls-like).
const FRAG = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uExposure;
uniform float uBrightness;
uniform float uContrast;
uniform float uSaturation;
void main() {
  vec3 c = texture2D(uTex, vUv).rgb;
  c *= pow(2.0, uExposure);
  c += uBrightness;
  c = (c - 0.5) * uContrast + 0.5;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSaturation);
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

function sourceSize(s: FrameSource): [number, number] {
  if (typeof HTMLVideoElement !== 'undefined' && s instanceof HTMLVideoElement) return [s.videoWidth, s.videoHeight];
  if (typeof VideoFrame !== 'undefined' && s instanceof VideoFrame) return [s.displayWidth, s.displayHeight];
  return [(s as HTMLCanvasElement).width, (s as HTMLCanvasElement).height];
}

/**
 * WebGL renderer that applies the lighting adjustments and letterboxes the frame into the canvas.
 * Used for both the live preview and export, so they look identical.
 */
export class GLFilterRenderer {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private gl: WebGLRenderingContext;
  private tex: WebGLTexture;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, preserveDrawingBuffer = false) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { preserveDrawingBuffer, premultipliedAlpha: false, alpha: false }) as WebGLRenderingContext | null;
    if (!gl) throw new Error('WebGL is not available in this browser.');
    this.gl = gl;

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader error');
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link error');
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    for (const n of ['uScale', 'uTex', 'uExposure', 'uBrightness', 'uContrast', 'uSaturation']) {
      this.uniforms[n] = gl.getUniformLocation(prog, n);
    }
    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.uniform1i(this.uniforms.uTex, 0);
  }

  /** Returns true when the size actually changed (the canvas is cleared by the browser). */
  resize(width: number, height: number): boolean {
    if (this.canvas.width === width && this.canvas.height === height) return false;
    this.canvas.width = width;
    this.canvas.height = height;
    return true;
  }

  clear() {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** Draws `source` fitted (contain) into the canvas with the adjustments applied. */
  draw(source: FrameSource, a: Adjustments) {
    const gl = this.gl;
    const [sw, sh] = sourceSize(source);
    this.clear();
    if (!sw || !sh) return;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const scale = Math.min(cw / sw, ch / sh);
    gl.uniform2f(this.uniforms.uScale, (sw * scale) / cw, (sh * scale) / ch);
    gl.uniform1f(this.uniforms.uExposure, a.exposure);
    gl.uniform1f(this.uniforms.uBrightness, a.brightness);
    gl.uniform1f(this.uniforms.uContrast, a.contrast);
    gl.uniform1f(this.uniforms.uSaturation, a.saturation);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source as TexImageSource);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
