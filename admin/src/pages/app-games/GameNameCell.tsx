import { Popover, Typography } from 'antd';

const NAME_TRUNC_PX = 220;

/** 固定宽度省略；点击浮层查看完整名称 */
export function GameNameCell({ text }: { text?: string }) {
  const s = text ?? '';
  if (!s) return <Typography.Text type="secondary">—</Typography.Text>;
  return (
    <Popover
      content={<div style={{ maxWidth: 480, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{s}</div>}
      trigger="click"
      placement="topLeft"
    >
      <Typography.Text
        ellipsis={{ tooltip: false }}
        style={{
          maxWidth: NAME_TRUNC_PX,
          display: 'inline-block',
          verticalAlign: 'bottom',
          cursor: 'pointer',
        }}
      >
        {s}
      </Typography.Text>
    </Popover>
  );
}

export const NAME_COL_WIDTH = 240;
