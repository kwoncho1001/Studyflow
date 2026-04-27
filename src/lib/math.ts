/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) return Infinity;
  let sumSquares = 0;
  for (let i = 0; i < a.length; i++) {
    sumSquares += Math.pow(a[i] - b[i], 2);
  }
  return Math.sqrt(sumSquares);
}

export function averageVector(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const avg = new Array(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) {
      avg[i] += v[i] || 0;
    }
  }
  return avg.map(v => v / vectors.length);
}

/**
 * Basic K-Means implementation
 */
export function kMeans(data: number[][], k: number, iterations: number = 20): { clusters: number[][]; centroids: number[][] } {
  if (data.length === 0 || k === 0) return { clusters: [], centroids: [] };
  
  // Use a copy to avoid mutating the original data
  let centroids = [...data].sort(() => 0.5 - Math.random()).slice(0, k);
  let assignments = new Array(data.length).fill(-1);

  for (let iter = 0; iter < iterations; iter++) {
    let changed = false;
    
    // Assign points to clusters
    for (let i = 0; i < data.length; i++) {
      let minDist = Infinity;
      let clusterIdx = -1;
      for (let j = 0; j < centroids.length; j++) {
        const dist = euclideanDistance(data[i], centroids[j]);
        if (dist < minDist) {
          minDist = dist;
          clusterIdx = j;
        }
      }
      if (assignments[i] !== clusterIdx) {
        assignments[i] = clusterIdx;
        changed = true;
      }
    }

    if (!changed && iter > 1) break;

    // Update centroids
    const newCentroids = new Array(k).fill(null).map(() => new Array(data[0].length).fill(0));
    const counts = new Array(k).fill(0);

    for (let i = 0; i < data.length; i++) {
      const idx = assignments[i];
      counts[idx]++;
      for (let d = 0; d < data[i].length; d++) {
        newCentroids[idx][d] += data[i][d];
      }
    }

    centroids = newCentroids.map((sum, i) => 
      counts[i] === 0 ? data[Math.floor(Math.random() * data.length)] : sum.map(s => s / counts[i])
    );
  }

  // Final clusters as indices
  const clusters = new Array(k).fill(null).map(() => []);
  for (let i = 0; i < assignments.length; i++) {
    clusters[assignments[i]].push(i as never);
  }

  return { clusters, centroids };
}
