export type Example = {
    id: number;
    name: string;
    icon: string;
    title: string;
    message: string;
    time: string;

    active: boolean;
    count: number | null;
    description?: string;

    tags: string[];
    scores: number[];

    status: "idle" | "loading" | "success" | "error";

    user: {
        id: number;
        name: string;
        avatar?: string;
    };

    metadata: Record<string, string>;
    users: Record<number, User>;

    items: Array<{
        id: number;
        label: string;
    }>;

    position: [number, number, number];

    value: string | number | boolean;

    callback: (id: number) => void;

    readonly createdAt: string;
};

export type User = {
    id: number;
    name: string;
    online: boolean;
};

export type Notification = {
    id: number;
    type: "info" | "success" | "warning" | "error";
    title: string;
    message: string;
    timestamp: number;
    read?: boolean;
};
