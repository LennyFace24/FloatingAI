import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// 每个测试后卸载组件树——否则测试间 DOM 残留（常驻 surface 结构下
// getAllByRole 会匹配到前一个测试的按钮，导致 mock 被错误消费）
afterEach(() => cleanup());
