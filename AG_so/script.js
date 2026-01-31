import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

// Setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
// Initial position, will be updated per letter
camera.position.z = 100;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

// Resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Shader
// Soft, semi-transparent, no specular, internal glow moving top to down
const vertexShader = `
    varying vec3 vViewPosition;
    varying vec3 vNormal;
    varying vec3 vPosition;
    varying vec2 vUv;

    void main() {
        vUv = uv;
        vPosition = position;
        
        // Standard transformation
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mvPosition.xyz;
        vNormal = normalMatrix * normal;
        
        gl_Position = projectionMatrix * mvPosition;
    }
`;

const fragmentShader = `
    uniform vec3 uColor;
    uniform float uScanY; // Current height of the light center
    uniform float uHeight; // Total height of the letter for normalization if needed
    
    varying vec3 vPosition;
    varying vec3 vNormal;
    varying vec3 vViewPosition;

    void main() {
        // 1. Light Flow
        // Calculate distance from the scan line
        float dist = vPosition.y - uScanY;
        
        // Create a soft band
        // Positive dist means pixel is above scanline. 
        // We want light to trail or surround the scanline.
        // Let's make a Gaussian-like bell curve or smoothstep falloff
        
        float spread = 35.0; // How wide the light band is
        float lightIntensity = 1.0 - smoothstep(0.0, spread, abs(dist));
        
        // Enhance: Make it asymmetrical? Maybe trail is longer.
        // For now, symmetric soft glow is good.
        
        // 2. Material "Soft Semi-Transparent"
        // No hard specular.
        // Use a bit of Rim lighting to define edges softly if the light is near
        vec3 normal = normalize(vNormal);
        vec3 viewDir = normalize(vViewPosition);
        float NdotV = dot(normal, viewDir);
        float rim = 1.0 - max(0.0, NdotV);
        rim = pow(rim, 3.0); // Soft rim
        
        // Base Opacity
        // The text shouldn't be invisible without light, but "Text shape is shown by light" implies darkness otherwise.
        // "Soft semi-transparent texture"
        float baseAlpha = 0.15; 
        
        // Combine
        vec3 finalColor = uColor * lightIntensity;
        
        // Add a bit of rim light that is also tinted by color, but only active near light??
        // Or global rim to show "shape"? 
        // "Light... reveals text form". So mostly dark without light.
        
        // Let's make the rim dependent on light proximity too, or just faint global rim.
        finalColor += uColor * rim * 0.3 * lightIntensity; 

        // Alpha Logic
        // We want it semi-transparent.
        float alpha = baseAlpha + (lightIntensity * 0.85);
        
        // Clamp
        // Alpha Logic
        // "Text should be opaque" -> alpha 1.0
        gl_FragColor = vec4(finalColor, 1.0);
    }
`;

const customMaterial = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
        uColor: { value: new THREE.Color() },
        uScanY: { value: 0.0 },
        uHeight: { value: 100.0 }
    },
    transparent: false, // Opaque
    depthWrite: true, // Opaque
    blending: THREE.NormalBlending, // Opaque solid
    side: THREE.DoubleSide
});

// Force generic blending instead of Additive to look more like 'Material' than 'Hologram'
customMaterial.blending = THREE.NormalBlending;
customMaterial.depthWrite = true; // Turn on for robust shape, might have artifacts if alpha < 1 but acceptable for this style.

// Config
const WORD = "ARSENAL";
const COLORS = [
    '#FF3232',
    '#4000FF',
    '#00FF88'
];
const CYCLE_DURATION = 1.0; // seconds
const LIGHT_DURATION = 1.0; // seconds

let currentIndex = 0;
let currentMesh = null;
let startTime = 0;
let letterStartTime = 0;

// Geometry Stats
let currentTopY = 0;
let currentBottomY = 0;

// Loader
const loader = new FontLoader();
loader.load('https://unpkg.com/three@0.160.0/examples/fonts/helvetiker_bold.typeface.json', (font) => {
    startSequence(font);
});

function startSequence(font) {
    // Animation Loop
    renderer.setAnimationLoop((time) => {
        // time is ms
        const now = time * 0.001;

        if (!currentMesh) {
            createLetter(font);
            letterStartTime = now;
        }

        const elapsed = now - letterStartTime;

        if (elapsed > CYCLE_DURATION) {
            // Next letter
            currentIndex = (currentIndex + 1) % WORD.length;
            createLetter(font);
            letterStartTime = now;
        }

        // Update Shader
        if (currentMesh) {
            // Light Flow Logic: 2 seconds duration
            // Map 0 -> 2.0 to Top -> Bottom

            let flowProgress = elapsed / LIGHT_DURATION;
            // Clamp or let it pass? "Process is 2s".
            if (flowProgress > 1.0) flowProgress = 1.0;

            // "Top to Bottom"
            // Start slightly above, end slightly below
            const margin = 60.0;
            const startY = currentTopY + margin;
            const endY = currentBottomY - margin;

            const currentY = THREE.MathUtils.lerp(startY, endY, flowProgress);

            currentMesh.material.uniforms.uScanY.value = currentY;

            // Optional: Fade out effect at the very end of 3s?
            // User says "Appears... disappears".
            // If the light passes fully, it goes dark (because shader uses dist).
            // So natural disappearance happens as light leaves the mesh.
        }

        renderer.render(scene, camera);
    });
}

function createLetter(font) {
    if (currentMesh) {
        scene.remove(currentMesh);
        currentMesh.geometry.dispose();
    }

    const char = WORD[currentIndex];
    const colorHex = COLORS[Math.floor(Math.random() * COLORS.length)];

    // "Very thick", "Gothic" (Helvetiker is sans-serif gothic-like)
    const geometry = new TextGeometry(char, {
        font: font,
        size: 50, // Base size
        height: 30, // "Very thick" - depth
        curveSegments: 12,
        bevelEnabled: true, // "Edges angular" -> bevel false is sharpest. 
        // User said "Each corner angular" but "soft material". 
        // Bevel false = 90 degree sharp. 
        // Bevel true with 1 segment = chamfered angular 45 degree.
        // "Edges absolute angular" -> likely bevelEnabled: false is safest interpretation of "sharp".
        bevelSize: 0,
        bevelThickness: 0
    });

    // Explicitly set bevel false for sharp edges as requested
    // "Alphabet each corner should be angular"

    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const sizeX = box.max.x - box.min.x;
    const sizeY = box.max.y - box.min.y;

    currentTopY = box.max.y;
    currentBottomY = box.min.y;

    // Center it
    const centerOffsetX = -0.5 * sizeX;
    const centerOffsetY = -0.5 * sizeY;
    const centerOffsetZ = -0.5 * 30; // half height

    geometry.translate(centerOffsetX, centerOffsetY, centerOffsetZ);

    // Recalculate box after center for Y bounds
    geometry.computeBoundingBox();
    currentTopY = geometry.boundingBox.max.y;
    currentBottomY = geometry.boundingBox.min.y;

    // Material Update
    // Clone logic? Or just reuse customMaterial
    // Need to clone if we want per-instance uniforms transitions?
    // But we destroy old mesh, so we can just update uniforms.
    customMaterial.uniforms.uColor.value.set(colorHex);
    customMaterial.uniforms.uHeight.value = sizeY;


    currentMesh = new THREE.Mesh(geometry, customMaterial);

    // Orientation: "Fill the screen"
    // "x, y, z within 45 degrees randomly"
    const range = Math.PI / 4; // 45 degrees
    const randX = (Math.random() - 0.5) * 2 * range; // [-45, 45]
    const randY = (Math.random() - 0.5) * 2 * range;
    const randZ = (Math.random() - 0.5) * 2 * range;

    currentMesh.rotation.set(randX, randY, randZ);

    scene.add(currentMesh);

    // Dynamic Camera Positioning to "Fill Screen Slightly Overflowing"
    // FOV 45
    // Visible Height at Z is: 2 * Z * tan(22.5deg)
    // We want Visible Height < Text Height? 
    // "Size slightly overflowing display" -> Text Height > Visible Height.
    // Text Height is sizeY.
    // Target Visible Height = sizeY * 0.85 (Screen shows 85% of text)
    // User wants 10% BIGGER -> Screen shows even LESS of the text.
    // 0.85 / 1.1 ~= 0.77
    const targetHeight = sizeY * 0.77;

    // Z = height / (2 * tan(fov/2))
    const dist = targetHeight / (2 * Math.tan(fov / 2));

    camera.position.z = dist + 15; // +15 for the front face offset (thickness/2)
}
