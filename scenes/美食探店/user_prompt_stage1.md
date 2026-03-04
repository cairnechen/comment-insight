请分析以下B站视频评论数据，识别并归一所有被提及的店铺/餐厅名称。

重要：本次只返回【发现阶段】的结果，不要对店铺进行任何详细分析。
输出合法JSON，包含三个字段（复用现有schema）：
- shops：置信度高的店铺
- omitted_shops：因差评/低质等原因归入省略类的店铺
- low_confidence_mentions：不确定是否为真实店名的文本

每个条目格式：
{
  "name": "归一化后的店铺名称",
  "rpids": [提到该店铺的评论rpid（整数数组）]
}

输出示例：
{
  "shops": [{"name": "某某火锅", "rpids": [12345, 67890]}],
  "omitted_shops": [{"name": "踩雷餐厅", "rpids": [11111]}],
  "low_confidence_mentions": [{"name": "可能是店名的文字", "rpids": [22222]}]
}
