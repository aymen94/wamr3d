// `#include`s of three.js shader materials for the vertex stage and for shadows, with
// three.js's names and meaning.
//
// Part of the WebGL 2 host; `./programs.js` resolves them. Derived from three.js's
// shader chunks (MIT, see the LICENSE notice of three.js).
//
// The shadow chunks read the engine's own shadow maps: one layer of a depth texture array
// per map, six for a point light (its cube faces +x, -x, +y, -y, +z, -z). Where three.js
// declares a sampler per map (`directionalShadowMap[ i ]` and the rest), these declare a
// vec4 of the same name: the share of the layer the map covers (xy), the layer (z, -1 when
// the engine drew no map for the light), and for a point light the first of its six face
// matrices in `wamr_point_shadow_faces` (w). `getShadow`, `getPointShadow` and
// `getShadowMask` take them as three.js's take the samplers, so shaders that call them as
// three.js documents compile unchanged, also in loops that are not unrolled.

const SHADOW_STRUCTS = `
struct DirectionalLightShadow { float shadowIntensity; float shadowBias; float shadowNormalBias; float shadowRadius; vec2 shadowMapSize; };
struct SpotLightShadow { float shadowIntensity; float shadowBias; float shadowNormalBias; float shadowRadius; vec2 shadowMapSize; };
struct PointLightShadow { float shadowIntensity; float shadowBias; float shadowNormalBias; float shadowRadius; vec2 shadowMapSize; float shadowCameraNear; float shadowCameraFar; };
`;

export const SHADER_CHUNKS = {

	begin_vertex: `
vec3 transformed = vec3( position );
`,

	beginnormal_vertex: `
vec3 objectNormal = vec3( normal );
`,

	// The normal in view space; instance matrices may scale unevenly but not shear.
	defaultnormal_vertex: `
vec3 transformedNormal = objectNormal;
#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
`,

	project_vertex: `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`,

	worldpos_vertex: `
#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined( USE_SHADOWMAP ) || defined( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif
`,

	packing: `
vec3 packNormalToRGB( const in vec3 normal ) { return normalize( normal ) * 0.5 + 0.5; }
vec3 unpackRGBToNormal( const in vec3 rgb ) { return 2.0 * rgb.xyz - 1.0; }
const float PackUpscale = 256. / 255.;
const float UnpackDownscale = 255. / 256.;
const float ShiftRight8 = 1. / 256.;
const float Inv255 = 1. / 255.;
const vec4 PackFactors = vec4( 1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0 );
const vec2 UnpackFactors2 = vec2( UnpackDownscale, 1.0 / PackFactors.g );
const vec3 UnpackFactors3 = vec3( UnpackDownscale / PackFactors.rg, 1.0 / PackFactors.b );
const vec4 UnpackFactors4 = vec4( UnpackDownscale / PackFactors.rgb, 1.0 / PackFactors.a );
vec4 packDepthToRGBA( const in float v ) {
	if ( v <= 0.0 ) return vec4( 0.0 );
	if ( v >= 1.0 ) return vec4( 1.0 );
	float vuf;
	float af = modf( v * PackFactors.a, vuf );
	float bf = modf( vuf * ShiftRight8, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec4( vuf * Inv255, gf * PackUpscale, bf * PackUpscale, af );
}
vec3 packDepthToRGB( const in float v ) {
	if ( v <= 0.0 ) return vec3( 0.0 );
	if ( v >= 1.0 ) return vec3( 1.0 );
	float vuf;
	float bf = modf( v * PackFactors.b, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec3( vuf * Inv255, gf * PackUpscale, bf );
}
vec2 packDepthToRG( const in float v ) {
	if ( v <= 0.0 ) return vec2( 0.0 );
	if ( v >= 1.0 ) return vec2( 1.0 );
	float vuf;
	float gf = modf( v * 256., vuf );
	return vec2( vuf * Inv255, gf );
}
float unpackRGBAToDepth( const in vec4 v ) { return dot( v, UnpackFactors4 ); }
float unpackRGBToDepth( const in vec3 v ) { return dot( v, UnpackFactors3 ); }
float unpackRGToDepth( const in vec2 v ) { return v.r * UnpackFactors2.r + v.g * UnpackFactors2.g; }
vec4 pack2HalfToRGBA( const in vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( const in vec4 v ) { return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) ); }
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) { return ( viewZ + near ) / ( near - far ); }
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) { return depth * ( near - far ) - near; }
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) { return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ ); }
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) { return ( near * far ) / ( ( far - near ) * depth - far ); }
`,

	shadowmap_pars_vertex: `
#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	out vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
${SHADOW_STRUCTS}
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		out vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		out vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif
`,

	// Needs `worldPosition` (worldpos_vertex) and `transformedNormal` (defaultnormal_vertex).
	shadowmap_vertex: `
#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	#ifdef HAS_NORMAL
		vec3 shadowWorldNormal = transformNormalByInverseViewMatrix( transformedNormal, viewMatrix );
	#else
		vec3 shadowWorldNormal = vec3( 0.0 );
	#endif
	vec4 shadowWorldPosition;
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
			if ( i < NUM_SPOT_LIGHT_SHADOWS ) shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
#endif
`,

	shadowmap_pars_fragment: `
#if NUM_SPOT_LIGHT_COORDS > 0
	in vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
${SHADOW_STRUCTS}
	uniform highp sampler2DArrayShadow wamr_shadow_map;
	#ifdef SHADOWMAP_TYPE_VSM
		uniform highp sampler2DArray wamr_vsm_map;
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform vec4 directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		in vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		uniform vec4 spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform vec4 pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		in vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
		// each face's projection, from the light-to-point vector to the face's map
		uniform mat4 wamr_point_shadow_faces[ NUM_POINT_LIGHT_SHADOWS * 6 ];
	#endif
	#if defined( SHADOWMAP_TYPE_PCF )
		float interleavedGradientNoise( vec2 position ) {
			return fract( 52.9829189 * fract( dot( position, vec2( 0.06711056, 0.00583715 ) ) ) );
		}
		vec2 vogelDiskSample( int sampleIndex, int samplesCount, float phi ) {
			const float goldenAngle = 2.399963229728653;
			float r = sqrt( ( float( sampleIndex ) + 0.5 ) / float( samplesCount ) );
			float theta = float( sampleIndex ) * goldenAngle + phi;
			return vec2( cos( theta ), sin( theta ) ) * r;
		}
	#endif
	// The light reaching a point of a map: 'coord' is on the map (xy 0..1) with the depth
	// to compare (z), 'radius' the PCF radius in map units.
	float wamr_shadow_sample( vec4 shadowMap, vec3 coord, float radius ) {
		#if defined( SHADOWMAP_TYPE_PCF )
			float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
			float shadow = 0.0;
			for ( int k = 0; k < 5; k ++ ) shadow += texture( wamr_shadow_map, vec4( ( coord.xy + vogelDiskSample( k, 5, phi ) * radius ) * shadowMap.xy, shadowMap.z, coord.z ) );
			return shadow * 0.2;
		#elif defined( SHADOWMAP_TYPE_VSM )
			vec2 distribution = textureLod( wamr_vsm_map, vec3( coord.xy * shadowMap.xy, shadowMap.z ), 0.0 ).xy;
			float mean = distribution.x;
			float variance = distribution.y * distribution.y;
			if ( coord.z <= mean ) return 1.0;
			variance = max( variance, 0.0000001 );
			float d = coord.z - mean;
			float p_max = variance / ( variance + d * d );
			return clamp( ( p_max - 0.3 ) / 0.65, 0.0, 1.0 );
		#else
			// the texel's own depth, compared without filtering
			vec2 size = vec2( textureSize( wamr_shadow_map, 0 ).xy );
			vec2 texel = ( floor( coord.xy * shadowMap.xy * size ) + 0.5 ) / size;
			return texture( wamr_shadow_map, vec4( texel, shadowMap.z, coord.z ) );
		#endif
	}
	float getShadow( vec4 shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
		if ( shadowMap.z < 0.0 ) return 1.0;
		float shadow = 1.0;
		shadowCoord.xyz /= shadowCoord.w;
		shadowCoord.z += shadowBias;
		bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
		if ( inFrustum && shadowCoord.z <= 1.0 ) shadow = wamr_shadow_sample( shadowMap, shadowCoord.xyz, shadowRadius / shadowMapSize.x );
		return mix( 1.0, shadow, shadowIntensity );
	}
	#if NUM_POINT_LIGHT_SHADOWS > 0 && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )
		// 'shadowCoord' is the vector from the light to the point, as three.js gives it.
		float getPointShadow( vec4 shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
			if ( shadowMap.z < 0.0 ) return 1.0;
			float shadow = 1.0;
			vec3 lightToPosition = shadowCoord.xyz;
			vec3 a = abs( lightToPosition );
			// depth is stored along the face's axis, not as the distance to the light
			float viewSpaceZ = max( max( a.x, a.y ), a.z );
			if ( viewSpaceZ - shadowCameraFar <= 0.0 && viewSpaceZ - shadowCameraNear >= 0.0 ) {
				int face = a.x >= a.y && a.x >= a.z ? ( lightToPosition.x > 0.0 ? 0 : 1 ) : a.y >= a.z ? ( lightToPosition.y > 0.0 ? 2 : 3 ) : ( lightToPosition.z > 0.0 ? 4 : 5 );
				vec4 projected = wamr_point_shadow_faces[ int( shadowMap.w ) + face ] * vec4( lightToPosition, 1.0 );
				float dp = ( shadowCameraFar * ( viewSpaceZ - shadowCameraNear ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) ) + shadowBias;
				// three.js offsets samples on the unit sphere, which spans a face twice over
				shadow = wamr_shadow_sample( vec4( shadowMap.xy, shadowMap.z + float( face ), 0.0 ), vec3( projected.xy / projected.w, dp ), shadowRadius * 0.5 / shadowMapSize.x );
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#endif
#endif
`,

	shadowmask_pars_fragment: `
float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
		#if NUM_DIR_LIGHT_SHADOWS > 0
			for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
				DirectionalLightShadow directionalLight = directionalLightShadows[ i ];
				shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowIntensity, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
			}
		#endif
		#if NUM_SPOT_LIGHT_SHADOWS > 0
			for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
				SpotLightShadow spotLight = spotLightShadows[ i ];
				shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowIntensity, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
			}
		#endif
		#if NUM_POINT_LIGHT_SHADOWS > 0 && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )
			for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
				PointLightShadow pointLight = pointLightShadows[ i ];
				shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowIntensity, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
			}
		#endif
	#endif
	return shadow;
}
`

};

/** The defines three.js derives from the shadows of a frame's lights, for `#include`s above. */
export function shadowDefines( lights ) {

	const [ , , , , directional, point, spot ] = lights?.counts ?? [ 0, 0, 0, 0, 0, 0, 0 ];
	let defines = `#define NUM_DIR_LIGHT_SHADOWS ${directional}\n#define NUM_POINT_LIGHT_SHADOWS ${point}\n#define NUM_SPOT_LIGHT_SHADOWS ${spot}\n#define NUM_SPOT_LIGHT_MAPS 0\n#define NUM_SPOT_LIGHT_COORDS ${spot}\n`;
	if ( lights?.shadowMap ) defines += `#define USE_SHADOWMAP\n#define SHADOWMAP_TYPE_${lights.shadowMap}\n`;
	return defines;

}

// Offsets in the engine's frame block (floats): the lights, 16 floats each, whose cone.z
// is the light's first shadow map plus one (0 for none), and the shadows, 24 floats each:
// the matrix to the map, bias and the rest, then the share of the layer, layer and filter.
const LIGHTS_FLOAT = 48, LIGHT_FLOATS = 16, SHADOWS_FLOAT = 304, SHADOW_FLOATS = 24;
const IDENTITY = [ 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 ];

/**
 * The shadow uniforms of shader materials that come from the engine's frame (`frame`, the
 * frame block's floats): each light's map, its matrices and the point lights' faces.
 * `lights` is the compat renderer's shader lights with their shadows.
 */
export function shadowUniforms( frame, lights ) {

	const out = {};
	if ( ! lights?.shadowMap ) return out;
	const firstLayer = ( light ) => ( light < 0 ? - 1 : Math.trunc( frame[ LIGHTS_FLOAT + light * LIGHT_FLOATS + 14 ] + 0.5 ) - 1 );
	const map = ( layer, faces ) => ( layer < 0 ? [ 0, 0, - 1, faces ] : [ frame[ SHADOWS_FLOAT + layer * SHADOW_FLOATS + 20 ], frame[ SHADOWS_FLOAT + layer * SHADOW_FLOATS + 21 ], layer, faces ] );
	const matrix = ( layer ) => ( layer < 0 ? IDENTITY : frame.subarray( SHADOWS_FLOAT + layer * SHADOW_FLOATS, SHADOWS_FLOAT + layer * SHADOW_FLOATS + 16 ) );

	for ( const [ kind, maps, matrices ] of [ [ 'directional', 'directionalShadowMap', 'directionalShadowMatrix' ], [ 'spot', 'spotShadowMap', 'spotLightMatrix' ] ] ) {

		const list = lights.shadows[ kind ];
		if ( list.length === 0 ) continue;
		out[ maps ] = list.map( ( shadow ) => map( firstLayer( shadow.light ), 0 ) );
		out[ matrices ] = list.map( ( shadow ) => matrix( firstLayer( shadow.light ) ) );

	}

	const points = lights.shadows.point;

	if ( points.length > 0 ) {

		out.pointShadowMap = [];
		out.pointShadowMatrix = [];
		out.wamr_point_shadow_faces = [];

		points.forEach( ( shadow, i ) => {

			const layer = firstLayer( shadow.light ), [ x, y, z ] = shadow.position;
			out.pointShadowMap.push( map( layer, i * 6 ) );
			// from a world position to the vector from the light, as three.js's point shadow matrix
			out.pointShadowMatrix.push( [ 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, - x, - y, - z, 1 ] );

			for ( let face = 0; face < 6; face ++ ) {

				// the face's matrix applied to light position + vector
				const m = layer < 0 ? IDENTITY : matrix( layer + face ), faceMatrix = Array.from( m );
				for ( let r = 0; r < 4; r ++ ) faceMatrix[ 12 + r ] = m[ r ] * x + m[ 4 + r ] * y + m[ 8 + r ] * z + m[ 12 + r ];
				out.wamr_point_shadow_faces.push( faceMatrix );

			}

		} );

	}

	return out;

}
