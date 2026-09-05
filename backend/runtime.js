'use strict';

const { AsyncLocalStorage } = require('async_hooks');

const runtimeStorage = new AsyncLocalStorage();

function runWithRuntime(runtime, fn) {
  return runtimeStorage.run(runtime, fn);
}

function currentRuntime() {
  return runtimeStorage.getStore() || null;
}

function getEnv(name, fallback = '') {
  const runtime = currentRuntime();
  if (runtime?.env && runtime.env[name] !== undefined) return runtime.env[name];
  return typeof process !== 'undefined' && process.env && process.env[name] !== undefined ? process.env[name] : fallback;
}

function getDbExecutor() {
  return currentRuntime()?.dbClient || null;
}

function trackTask(task, label = 'background') {
  const promise = Promise.resolve(task).catch((error) => {
    console.error(`[${label}]`, error?.message || error);
  });
  const runtime = currentRuntime();
  if (runtime?.pendingTasks) runtime.pendingTasks.push(promise);
  return promise;
}

async function flushTasks() {
  const runtime = currentRuntime();
  if (!runtime?.pendingTasks?.length) return;
  while (runtime.pendingTasks.length) {
    const batch = runtime.pendingTasks.splice(0);
    await Promise.allSettled(batch);
  }
}

module.exports = { runWithRuntime, currentRuntime, getEnv, getDbExecutor, trackTask, flushTasks };
