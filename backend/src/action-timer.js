export async function timedAction(label, work) {
  const started = performance.now();
  console.log(`${label}: started`);
  try {
    const result = await work();
    console.log(`${label}: completed in ${(performance.now() - started).toFixed(3)} ms`);
    return result;
  } catch (error) {
    console.error(`${label}: failed after ${(performance.now() - started).toFixed(3)} ms`);
    throw error;
  }
}
