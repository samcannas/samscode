export interface Disposable {
  dispose(): void;
}

export type Listener<T> = (value: T) => void;
