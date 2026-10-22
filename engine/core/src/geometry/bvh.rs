use crate::attribute::AttributeAccess;
use super::BufferGeometry;
use wamr_math::{Box3, Ray, Vector3};

#[derive(Clone, Debug)]
pub(crate) struct TriangleBvh {
    nodes: Vec<Node>,
    triangles: Vec<(usize, [usize; 3])>,
}

#[derive(Clone, Debug)]
struct Node {
    bounds: Box3,
    left: Option<usize>,
    right: Option<usize>,
    start: usize,
    end: usize,
}

impl TriangleBvh {
    pub(crate) fn build(geometry: &BufferGeometry) -> Option<Self> {
        let positions = geometry.get_attribute("position")?;
        let index = geometry.get_index();
        let count = index.map_or(positions.count(), |a| a.count()) / 3;
        if count < 16 { return None; }
        let triangles = (0..count).map(|i| {
            let vertex = |j| index.map_or(i * 3 + j, |a| a.array.get(i * 3 + j) as usize);
            (i, [vertex(0), vertex(1), vertex(2)])
        }).collect::<Vec<_>>();
        let mut tree = Self { nodes: Vec::with_capacity(count * 2), triangles };
        let order = (0..count).collect::<Vec<_>>();
        tree.build_node(geometry, order);
        Some(tree)
    }

    fn triangle_bounds(geometry: &BufferGeometry, tri: [usize; 3]) -> Box3 {
        let p = geometry.get_attribute("position").unwrap();
        let mut b = Box3::default();
        for i in tri { b.expand_by_point(&p.get_vector3(i)); }
        b
    }

    fn build_node(&mut self, geometry: &BufferGeometry, order: Vec<usize>) -> usize {
        let mut bounds = Box3::default();
        let mut centroids = Vec::with_capacity(order.len());
        for &i in &order {
            let b = Self::triangle_bounds(geometry, self.triangles[i].1);
            bounds.union(&b);
            centroids.push((i, b.get_center()));
        }
        let node_index = self.nodes.len();
        let start = self.triangles.len();
        self.nodes.push(Node { bounds, left: None, right: None, start, end: start });
        if order.len() <= 8 {
            let begin = self.triangles.len();
            let picked = order.iter().map(|&i| self.triangles[i]).collect::<Vec<_>>();
            // Leaf triangles are stored in a separate tail to keep traversal contiguous.
            self.triangles.extend(picked);
            self.nodes[node_index].start = begin;
            self.nodes[node_index].end = self.triangles.len();
            return node_index;
        }
        let extent = [bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z];
        let axis = if extent[0] >= extent[1] && extent[0] >= extent[2] { 0 } else if extent[1] >= extent[2] { 1 } else { 2 };
        centroids.sort_by(|a,b| coord(a.1, axis).total_cmp(&coord(b.1, axis)));
        let mid = centroids.len() / 2;
        let left_order = centroids[..mid].iter().map(|x| x.0).collect();
        let right_order = centroids[mid..].iter().map(|x| x.0).collect();
        let left = self.build_node(geometry, left_order);
        let right = self.build_node(geometry, right_order);
        self.nodes[node_index].left = Some(left);
        self.nodes[node_index].right = Some(right);
        node_index
    }

    pub(crate) fn candidates(&self, ray: &Ray) -> Vec<(usize, [usize; 3])> {
        let mut out = Vec::new();
        let mut stack = vec![0];
        while let Some(i) = stack.pop() {
            let node = &self.nodes[i];
            if !ray.intersects_box(&node.bounds) { continue; }
            if let (Some(left), Some(right)) = (node.left, node.right) {
                stack.push(left);
                stack.push(right);
            } else {
                out.extend_from_slice(&self.triangles[node.start..node.end]);
            }
        }
        out
    }
}

fn coord(v: Vector3, axis: usize) -> f32 { [v.x, v.y, v.z][axis] }

impl BufferGeometry {
    pub(crate) fn bvh_signature(&self) -> u64 {
        use std::hash::{Hash, Hasher};
        let mut h = std::collections::hash_map::DefaultHasher::new();
        if let Some(p) = self.get_attribute("position") { p.version.hash(&mut h); p.count().hash(&mut h); }
        if let Some(i) = self.get_index() { i.version.hash(&mut h); i.count().hash(&mut h); }
        h.finish()
    }

    #[doc(hidden)]
    pub fn raycast_bvh_candidates(&self, ray: &Ray) -> Option<Vec<(usize, [usize; 3])>> {
        let signature = self.bvh_signature();
        let mut cache = self.raycast_bvh.borrow_mut();
        if cache.as_ref().is_none_or(|(key, _)| *key != signature) {
            *cache = TriangleBvh::build(self).map(|tree| (signature, tree));
        }
        cache.as_ref().map(|(_, tree)| {
            let mut candidates = tree.candidates(ray);
            candidates.sort_by_key(|(triangle, _)| *triangle);
            candidates
        })
    }
}
