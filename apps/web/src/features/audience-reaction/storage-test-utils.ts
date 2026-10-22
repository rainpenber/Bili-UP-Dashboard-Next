/** 测试用：恢复 happy-dom localStorage 原型方法，避免用例间 mock 泄漏 */
export function restoreLocalStorageMethods(): void {
  const proto = Object.getPrototypeOf(localStorage) as Storage;
  Object.defineProperty(localStorage, 'getItem', {
    configurable: true,
    writable: true,
    value: proto.getItem.bind(localStorage),
  });
  Object.defineProperty(localStorage, 'setItem', {
    configurable: true,
    writable: true,
    value: proto.setItem.bind(localStorage),
  });
  Object.defineProperty(localStorage, 'removeItem', {
    configurable: true,
    writable: true,
    value: proto.removeItem.bind(localStorage),
  });
}
