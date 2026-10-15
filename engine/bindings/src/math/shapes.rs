//! Bounding volumes and other shapes: `Box3`, `Sphere`, `Plane`, `Ray`, `Frustum`,
//! `Line3`, `Triangle`, `Spherical` and `Cylindrical`, forwarded with the macros of the
//! parent module.

use super::*;

// ---------------------------------------------------------------- Box3

class!(Box3, wamr_math::Box3);

#[wasm_bindgen]
impl Box3 {
    /// An empty box.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Box3 {
        Box3::default()
    }

    #[wasm_bindgen(getter)]
    pub fn min(&self) -> Vector3 {
        wrap(self.inner.min)
    }

    #[wasm_bindgen(getter)]
    pub fn max(&self) -> Vector3 {
        wrap(self.inner.max)
    }

    /// The box around a flat list of xyz positions.
    #[wasm_bindgen(js_name = setFromArray)]
    pub fn set_from_array(&mut self, positions: &[f32]) {
        self.inner.set_from_array(positions);
    }

    #[wasm_bindgen(js_name = getCenter)]
    pub fn get_center(&self) -> Vector3 {
        wrap(self.inner.get_center())
    }

    #[wasm_bindgen(js_name = getSize)]
    pub fn get_size(&self) -> Vector3 {
        wrap(self.inner.get_size())
    }

    #[wasm_bindgen(js_name = clampPoint)]
    pub fn clamp_point(&self, point: &Vector3) -> Vector3 {
        wrap(self.inner.clamp_point(&point.inner))
    }

    #[wasm_bindgen(js_name = getBoundingSphere)]
    pub fn get_bounding_sphere(&self) -> Sphere {
        Sphere { inner: self.inner.get_bounding_sphere() }
    }
}

mutate!(Box3 {
    "makeEmpty" make_empty();
    "expandByScalar" expand_by_scalar(scalar: f32);
});
mutate_with!(Box3 {
    "set" set(min: Vector3, max: Vector3);
    "setFromCenterAndSize" set_from_center_and_size(center: Vector3, size: Vector3);
    "expandByPoint" expand_by_point(point: Vector3);
    "expandByVector" expand_by_vector(vector: Vector3);
    "intersect" intersect(other: Box3);
    "union" union(other: Box3);
    "applyMatrix4" apply_matrix4(m: Matrix4);
    "translate" translate(offset: Vector3);
});
query!(Box3 {
    "isEmpty" is_empty() -> bool;
    "containsPoint" contains_point(point: Vector3) -> bool;
    "containsBox" contains_box(other: Box3) -> bool;
    "intersectsBox" intersects_box(other: Box3) -> bool;
    "intersectsSphere" intersects_sphere(sphere: Sphere) -> bool;
    "intersectsPlane" intersects_plane(plane: Plane) -> bool;
    "distanceToPoint" distance_to_point(point: Vector3) -> f32;
    "equals" equals(other: Box3) -> bool;
});

// ---------------------------------------------------------------- Sphere

class!(Sphere, wamr_math::Sphere);

#[wasm_bindgen]
impl Sphere {
    #[wasm_bindgen(constructor)]
    pub fn new(center: &Vector3, radius: f32) -> Sphere {
        Sphere { inner: wamr_math::Sphere::new(center.inner, radius) }
    }

    #[wasm_bindgen(getter)]
    pub fn center(&self) -> Vector3 {
        wrap(self.inner.center)
    }

    #[wasm_bindgen(getter)]
    pub fn radius(&self) -> f32 {
        self.inner.radius
    }

    #[wasm_bindgen(setter)]
    pub fn set_radius(&mut self, radius: f32) {
        self.inner.radius = radius;
    }

    pub fn set(&mut self, center: &Vector3, radius: f32) {
        self.inner.set(&center.inner, radius);
    }

    #[wasm_bindgen(js_name = clampPoint)]
    pub fn clamp_point(&self, point: &Vector3) -> Vector3 {
        wrap(self.inner.clamp_point(&point.inner))
    }

    #[wasm_bindgen(js_name = getBoundingBox)]
    pub fn get_bounding_box(&self) -> Box3 {
        Box3 { inner: self.inner.get_bounding_box() }
    }
}

mutate!(Sphere { "makeEmpty" make_empty(); });
mutate_with!(Sphere {
    "applyMatrix4" apply_matrix4(m: Matrix4);
    "translate" translate(offset: Vector3);
    "expandByPoint" expand_by_point(point: Vector3);
    "union" union(other: Sphere);
});
query!(Sphere {
    "isEmpty" is_empty() -> bool;
    "containsPoint" contains_point(point: Vector3) -> bool;
    "distanceToPoint" distance_to_point(point: Vector3) -> f32;
    "intersectsSphere" intersects_sphere(other: Sphere) -> bool;
    "intersectsBox" intersects_box(other: Box3) -> bool;
    "intersectsPlane" intersects_plane(plane: Plane) -> bool;
    "equals" equals(other: Sphere) -> bool;
});

// ---------------------------------------------------------------- Plane

class!(Plane, wamr_math::Plane);

#[wasm_bindgen]
impl Plane {
    /// The plane `normal . p + constant = 0`.
    #[wasm_bindgen(constructor)]
    pub fn new(normal: &Vector3, constant: f32) -> Plane {
        Plane { inner: wamr_math::Plane::new(normal.inner, constant) }
    }

    #[wasm_bindgen(getter)]
    pub fn normal(&self) -> Vector3 {
        wrap(self.inner.normal)
    }

    #[wasm_bindgen(getter)]
    pub fn constant(&self) -> f32 {
        self.inner.constant
    }

    #[wasm_bindgen(setter)]
    pub fn set_constant(&mut self, constant: f32) {
        self.inner.constant = constant;
    }

    #[wasm_bindgen(js_name = setFromCoplanarPoints)]
    pub fn set_from_coplanar_points(&mut self, a: &Vector3, b: &Vector3, c: &Vector3) {
        self.inner.set_from_coplanar_points(&a.inner, &b.inner, &c.inner);
    }

    #[wasm_bindgen(js_name = projectPoint)]
    pub fn project_point(&self, point: &Vector3) -> Vector3 {
        wrap(self.inner.project_point(&point.inner))
    }

    #[wasm_bindgen(js_name = coplanarPoint)]
    pub fn coplanar_point(&self) -> Vector3 {
        wrap(self.inner.coplanar_point())
    }

    /// Transforms the plane by an affine matrix.
    #[wasm_bindgen(js_name = applyMatrix4)]
    pub fn apply_matrix4(&mut self, m: &Matrix4) {
        self.inner.apply_matrix4(&m.inner, None);
    }
}

mutate!(Plane {
    "setComponents" set_components(x: f32, y: f32, z: f32, w: f32);
    "normalize" normalize();
    "negate" negate();
});
mutate_with!(Plane {
    "setFromNormalAndCoplanarPoint" set_from_normal_and_coplanar_point(normal: Vector3, point: Vector3);
    "translate" translate(offset: Vector3);
});
query!(Plane {
    "distanceToPoint" distance_to_point(point: Vector3) -> f32;
    "distanceToSphere" distance_to_sphere(sphere: Sphere) -> f32;
    "intersectsBox" intersects_box(other: Box3) -> bool;
    "intersectsSphere" intersects_sphere(sphere: Sphere) -> bool;
    "equals" equals(other: Plane) -> bool;
});

// ---------------------------------------------------------------- Ray

class!(Ray, wamr_math::Ray);

#[wasm_bindgen]
impl Ray {
    /// `direction` must be normalized.
    #[wasm_bindgen(constructor)]
    pub fn new(origin: &Vector3, direction: &Vector3) -> Ray {
        Ray { inner: wamr_math::Ray::new(origin.inner, direction.inner) }
    }

    #[wasm_bindgen(getter)]
    pub fn origin(&self) -> Vector3 {
        wrap(self.inner.origin)
    }

    #[wasm_bindgen(getter)]
    pub fn direction(&self) -> Vector3 {
        wrap(self.inner.direction)
    }

    pub fn at(&self, t: f32) -> Vector3 {
        wrap(self.inner.at(t))
    }

    #[wasm_bindgen(js_name = closestPointToPoint)]
    pub fn closest_point_to_point(&self, point: &Vector3) -> Vector3 {
        wrap(self.inner.closest_point_to_point(&point.inner))
    }

    /// The hit point, or `undefined`.
    #[wasm_bindgen(js_name = intersectSphere)]
    pub fn intersect_sphere(&self, sphere: &Sphere) -> Option<Vector3> {
        self.inner.intersect_sphere(&sphere.inner).map(wrap)
    }

    /// The distance along the ray to the plane, or `undefined`.
    #[wasm_bindgen(js_name = distanceToPlane)]
    pub fn distance_to_plane(&self, plane: &Plane) -> Option<f32> {
        self.inner.distance_to_plane(&plane.inner)
    }

    /// The hit point, or `undefined`.
    #[wasm_bindgen(js_name = intersectPlane)]
    pub fn intersect_plane(&self, plane: &Plane) -> Option<Vector3> {
        self.inner.intersect_plane(&plane.inner).map(wrap)
    }

    /// The hit point, or `undefined`.
    #[wasm_bindgen(js_name = intersectBox)]
    pub fn intersect_box(&self, other: &Box3) -> Option<Vector3> {
        self.inner.intersect_box(&other.inner).map(wrap)
    }

    /// The hit point on triangle `a`, `b`, `c`, or `undefined`.
    #[wasm_bindgen(js_name = intersectTriangle)]
    pub fn intersect_triangle(&self, a: &Vector3, b: &Vector3, c: &Vector3, backface_culling: bool) -> Option<Vector3> {
        self.inner.intersect_triangle(&a.inner, &b.inner, &c.inner, backface_culling).map(wrap)
    }
}

mutate!(Ray { "recast" recast(t: f32); });
mutate_with!(Ray {
    "set" set(origin: Vector3, direction: Vector3);
    "lookAt" look_at(v: Vector3);
    "applyMatrix4" apply_matrix4(m: Matrix4);
});
query!(Ray {
    "distanceToPoint" distance_to_point(point: Vector3) -> f32;
    "distanceSqToPoint" distance_sq_to_point(point: Vector3) -> f32;
    "intersectsSphere" intersects_sphere(sphere: Sphere) -> bool;
    "intersectsPlane" intersects_plane(plane: Plane) -> bool;
    "intersectsBox" intersects_box(other: Box3) -> bool;
    "equals" equals(other: Ray) -> bool;
});

// ---------------------------------------------------------------- Frustum

class!(Frustum, wamr_math::Frustum);

#[wasm_bindgen]
impl Frustum {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Frustum {
        Frustum::default()
    }

    /// `m` is usually projection * view. `webgpu` selects clip-space depth 0..1.
    #[wasm_bindgen(js_name = setFromProjectionMatrix)]
    pub fn set_from_projection_matrix(&mut self, m: &Matrix4, webgpu: bool, reversed_depth: bool) {
        self.inner.set_from_projection_matrix(&m.inner, coordinate_system(webgpu), reversed_depth);
    }
}

query!(Frustum {
    "intersectsSphere" intersects_sphere(sphere: Sphere) -> bool;
    "intersectsBox" intersects_box(other: Box3) -> bool;
    "containsPoint" contains_point(point: Vector3) -> bool;
});

// ---------------------------------------------------------------- Line3

class!(Line3, wamr_math::Line3);

#[wasm_bindgen]
impl Line3 {
    #[wasm_bindgen(constructor)]
    pub fn new(start: &Vector3, end: &Vector3) -> Line3 {
        Line3 { inner: wamr_math::Line3::new(start.inner, end.inner) }
    }

    #[wasm_bindgen(getter)]
    pub fn start(&self) -> Vector3 {
        wrap(self.inner.start)
    }

    #[wasm_bindgen(getter)]
    pub fn end(&self) -> Vector3 {
        wrap(self.inner.end)
    }

    #[wasm_bindgen(js_name = getCenter)]
    pub fn get_center(&self) -> Vector3 {
        wrap(self.inner.get_center())
    }

    pub fn delta(&self) -> Vector3 {
        wrap(self.inner.delta())
    }

    pub fn at(&self, t: f32) -> Vector3 {
        wrap(self.inner.at(t))
    }

    #[wasm_bindgen(js_name = closestPointToPointParameter)]
    pub fn closest_point_to_point_parameter(&self, point: &Vector3, clamp_to_line: bool) -> f32 {
        self.inner.closest_point_to_point_parameter(&point.inner, clamp_to_line)
    }

    #[wasm_bindgen(js_name = closestPointToPoint)]
    pub fn closest_point_to_point(&self, point: &Vector3, clamp_to_line: bool) -> Vector3 {
        wrap(self.inner.closest_point_to_point(&point.inner, clamp_to_line))
    }

    /// Squared distance between the closest points of two segments.
    #[wasm_bindgen(js_name = distanceSqToLine3)]
    pub fn distance_sq_to_line3(&self, line: &Line3) -> f32 {
        self.inner.distance_sq_to_line3(&line.inner, None, None)
    }
}

mutate_with!(Line3 {
    "set" set(start: Vector3, end: Vector3);
    "applyMatrix4" apply_matrix4(m: Matrix4);
});
query!(Line3 {
    "distance" distance() -> f32;
    "distanceSq" distance_sq() -> f32;
    "equals" equals(line: Line3) -> bool;
});

// ---------------------------------------------------------------- Triangle

class!(Triangle, wamr_math::Triangle);

#[wasm_bindgen]
impl Triangle {
    #[wasm_bindgen(constructor)]
    pub fn new(a: &Vector3, b: &Vector3, c: &Vector3) -> Triangle {
        Triangle { inner: wamr_math::Triangle::new(a.inner, b.inner, c.inner) }
    }

    #[wasm_bindgen(getter)]
    pub fn a(&self) -> Vector3 {
        wrap(self.inner.a)
    }

    #[wasm_bindgen(getter)]
    pub fn b(&self) -> Vector3 {
        wrap(self.inner.b)
    }

    #[wasm_bindgen(getter)]
    pub fn c(&self) -> Vector3 {
        wrap(self.inner.c)
    }

    #[wasm_bindgen(js_name = getMidpoint)]
    pub fn get_midpoint(&self) -> Vector3 {
        wrap(self.inner.get_midpoint())
    }

    #[wasm_bindgen(js_name = getNormal)]
    pub fn get_normal(&self) -> Vector3 {
        wrap(self.inner.get_normal())
    }

    #[wasm_bindgen(js_name = getPlane)]
    pub fn get_plane(&self) -> Plane {
        Plane { inner: self.inner.get_plane() }
    }

    /// `undefined` for a degenerate triangle.
    #[wasm_bindgen(js_name = getBarycoord)]
    pub fn get_barycoord(&self, point: &Vector3) -> Option<Vector3> {
        self.inner.get_barycoord(&point.inner).map(wrap)
    }

    #[wasm_bindgen(js_name = closestPointToPoint)]
    pub fn closest_point_to_point(&self, point: &Vector3) -> Vector3 {
        wrap(self.inner.closest_point_to_point(&point.inner))
    }
}

mutate_with!(Triangle {
    "set" set(a: Vector3, b: Vector3, c: Vector3);
});
query!(Triangle {
    "getArea" get_area() -> f32;
    "containsPoint" contains_point(point: Vector3) -> bool;
    "isFrontFacing" is_front_facing(direction: Vector3) -> bool;
    "intersectsBox" intersects_box(b: Box3) -> bool;
    "equals" equals(triangle: Triangle) -> bool;
});

// ---------------------------------------------------------------- Spherical

class!(Spherical, wamr_math::Spherical);
fields!(Spherical { radius set_radius; phi set_phi; theta set_theta; });

#[wasm_bindgen]
impl Spherical {
    /// Radius, polar angle from +Y and azimuth around Y, in radians.
    #[wasm_bindgen(constructor)]
    pub fn new(radius: f32, phi: f32, theta: f32) -> Spherical {
        Spherical { inner: wamr_math::Spherical::new(radius, phi, theta) }
    }
}

mutate!(Spherical {
    "set" set(radius: f32, phi: f32, theta: f32);
    "makeSafe" make_safe();
    "setFromCartesianCoords" set_from_cartesian_coords(x: f32, y: f32, z: f32);
});
mutate_with!(Spherical {
    "setFromVector3" set_from_vector3(v: Vector3);
});

// ---------------------------------------------------------------- Cylindrical

class!(Cylindrical, wamr_math::Cylindrical);
fields!(Cylindrical { radius set_radius; theta set_theta; y set_y; });

#[wasm_bindgen]
impl Cylindrical {
    /// Distance from the Y axis, angle around it in radians, height.
    #[wasm_bindgen(constructor)]
    pub fn new(radius: f32, theta: f32, y: f32) -> Cylindrical {
        Cylindrical { inner: wamr_math::Cylindrical::new(radius, theta, y) }
    }
}

mutate!(Cylindrical {
    "set" set(radius: f32, theta: f32, y: f32);
    "setFromCartesianCoords" set_from_cartesian_coords(x: f32, y: f32, z: f32);
});
mutate_with!(Cylindrical {
    "setFromVector3" set_from_vector3(v: Vector3);
});

mutate_with!(Vector3 {
    "setFromSpherical" set_from_spherical(s: Spherical);
    "setFromCylindrical" set_from_cylindrical(c: Cylindrical);
});
