import { Button, Input, Select, Space, Table, Tag, Image, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { adminApi } from "../api/admin";
import type { YouTubeVideoRow } from "../types";

export function YouTubeVideoPage() {
  const [searchParams] = useSearchParams();
  const [rows, setRows] = useState<YouTubeVideoRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [channelTitle, setChannelTitle] = useState("");
  const [liveOnly, setLiveOnly] = useState<string | undefined>();

  useEffect(() => {
    const ct = searchParams.get("channelTitle");
    const lo = searchParams.get("liveOnly");
    setChannelTitle(ct ?? "");
    setLiveOnly(lo && lo.length > 0 ? lo : undefined);
  }, [searchParams]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await adminApi.youtubeVideos({
        channelTitle: channelTitle.trim() || undefined,
        liveOnly: liveOnly === "live",
      });
      setRows(list);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [channelTitle, liveOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const cols: ColumnsType<YouTubeVideoRow> = [
    {
      title: "缩略图",
      dataIndex: "snippet",
      key: "thumbnail",
      width: 100,
      render: (snippet) => (
        <Image
          src={snippet.thumbnails.default.url}
          alt={snippet.title}
          width={90}
          height={68}
          style={{ objectFit: "cover" }}
        />
      ),
    },
    {
      title: "视频标题",
      dataIndex: "snippet",
      key: "title",
      ellipsis: true,
      render: (snippet, record) => (
        <a
          href={`https://www.youtube.com/watch?v=${record.id.videoId}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#1890ff" }}
        >
          {snippet.title}
        </a>
      ),
    },
    {
      title: "频道",
      dataIndex: "snippet",
      key: "channelTitle",
      width: 150,
      ellipsis: true,
      render: (snippet) => <Tag color="blue">{snippet.channelTitle}</Tag>,
    },
    {
      title: "发布时间",
      dataIndex: "snippet",
      key: "publishedAt",
      width: 180,
      render: (snippet) => {
        const date = new Date(snippet.publishedAt);
        return date.toLocaleString("zh-CN");
      },
    },
    {
      title: "状态",
      dataIndex: "snippet",
      key: "liveBroadcastContent",
      width: 100,
      render: (snippet) => (
        <Tag color={snippet.liveBroadcastContent === "live" ? "red" : "green"}>
          {snippet.liveBroadcastContent === "live" ? "直播中" : "已发布"}
        </Tag>
      ),
    },
    {
      title: "描述",
      dataIndex: "snippet",
      key: "description",
      ellipsis: { showTitle: false },
      render: (snippet) => snippet.description,
    },
  ];

  return (
    <div>
      <Space wrap style={{ marginBottom: 16 }}>
        <Input
          placeholder="频道名称"
          value={channelTitle}
          onChange={(e) => setChannelTitle(e.target.value)}
          style={{ width: 200 }}
        />
        <Select
          allowClear
          placeholder="直播状态"
          style={{ width: 140 }}
          value={liveOnly}
          onChange={setLiveOnly}
          options={[{ value: "live", label: "直播中" }]}
        />
        <Button onClick={() => void load()}>刷新</Button>
      </Space>
      <Table
        rowKey={(record) => record.id.videoId}
        loading={loading}
        columns={cols}
        dataSource={rows}
        scroll={{ x: 1200 }}
      />
    </div>
  );
}
