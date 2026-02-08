import { describe, it, expect } from 'vitest';
import { collectJavaLocals } from '../../../../../src/analyzer/languages/java/javaLocalCollector';

describe('javaLocalCollector', () => {
  it('should collect private methods', () => {
    const content = `public class Service {
    public void doSomething() {
        internal();
    }

    private void internal() {
        System.out.println("internal");
    }
}`;
    const exported = new Set(['Service', 'doSomething']);
    const locals = collectJavaLocals(content, exported);
    expect(locals).toHaveLength(1);
    expect(locals[0].name).toBe('internal');
    expect(locals[0].kind).toBe('method');
  });

  it('should count references correctly', () => {
    const content = `public class Service {
    private void helper() {}

    public void a() { helper(); }
    public void b() { helper(); }
}`;
    const exported = new Set(['Service', 'a', 'b']);
    const locals = collectJavaLocals(content, exported);
    expect(locals[0].name).toBe('helper');
    expect(locals[0].references).toBe(2);
  });

  it('should detect unused private methods (0 references)', () => {
    const content = `public class Service {
    private void unused() {
        System.out.println("dead");
    }

    public void active() {
        System.out.println("alive");
    }
}`;
    const exported = new Set(['Service', 'active']);
    const locals = collectJavaLocals(content, exported);
    expect(locals[0].name).toBe('unused');
    expect(locals[0].references).toBe(0);
  });

  it('should collect private fields', () => {
    const content = `public class Config {
    private String secret = "hidden";
    public String name = "visible";
}`;
    const exported = new Set(['Config', 'name']);
    const locals = collectJavaLocals(content, exported);
    expect(locals).toHaveLength(1);
    expect(locals[0].name).toBe('secret');
    expect(locals[0].kind).toBe('field');
  });

  it('should detect private static final as constant', () => {
    const content = `public class Config {
    private static final int MAX_RETRIES = 3;
}`;
    const exported = new Set(['Config']);
    const locals = collectJavaLocals(content, exported);
    expect(locals).toHaveLength(1);
    expect(locals[0].name).toBe('MAX_RETRIES');
    expect(locals[0].kind).toBe('constant');
  });

  it('should collect private inner classes', () => {
    const content = `public class Outer {
    private static class Inner {
        void doWork() {}
    }
}`;
    const exported = new Set(['Outer']);
    const locals = collectJavaLocals(content, exported);
    expect(locals).toHaveLength(1);
    expect(locals[0].name).toBe('Inner');
    expect(locals[0].kind).toBe('class');
  });

  it('should include line numbers', () => {
    const content = `public class Service {
    private void first() {}

    private void second() {}
}`;
    const exported = new Set(['Service']);
    const locals = collectJavaLocals(content, exported);
    expect(locals[0].line).toBe(2);
    expect(locals[1].line).toBe(4);
  });

  it('should not count references in comments', () => {
    const content = `public class Service {
    private void helper() {}

    // helper does things
    public void main() {}
}`;
    const exported = new Set(['Service', 'main']);
    const locals = collectJavaLocals(content, exported);
    expect(locals[0].name).toBe('helper');
    expect(locals[0].references).toBe(0);
  });
});
